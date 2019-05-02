var config = require('config');
var HttpError = require('httperrors')
var Router = require('express-promise-router')
var Request = require('request-promise')
var CronJob = require('cron').CronJob;
var CalendarItem = require('../persist').CalendarItem;
var Singleton = require('../persist').Singleton;
var AuthC = require('../authenticate');
var AuthZ = require('../authorize');
var _ = require('lodash')
var Databus = require('./databus');
var TARDY_MS = 1000 * 60 * 2; // OK to schedule AT jobs if tardy by 2 mins (max reboot time)

// Hash of CalendarItem.id to started cron entry
var cronEntries = {};

// Calendar ends Singleton object - for items needing End processing
// data: {Hash of CalendarItem.id to end timestamps}
var calendarEnds = null;

var calendar = module.exports = Router()

/* Example
{
  "id": "d43159d3-c314-4ecd-9442-fd7b586808fe",
  "type": "calendarItem",
  "name": "Weekly Status Report",
  "notes": "Triggered 04:00:00 every Monday morning",
  "at": "",
  "cron": "0 0 4 * * mon",
  "durationSecs": 0,
  "tags": [
    "company",
    "report",
    "status"
  ],
  "api": {
    "url": "/reports/run/dashboard",  // NOTE: Has no /site/{id} in front of it
    "method": "POST",
    "headers": {},  // optional - correct headers set for POST w/body
    "body": {
      "dashName": "company-performance",
      "retainDays": 90,
      "width": 450,
      "theme": "light",
      "format": "pdf",
      "sendTo": [
        "user/d40bb2d4-1547-4e75-ada6-0a1c6c516708",
        "user/643b00b9-5942-4408-a1ab-f34a8ac85902",
        "person@domain.com"
      ]
    }
  },
  "endApi": {},
  "links": {
    "runAs": {
      "href": "users/d40bb2d4-1547-4e75-ada6-0a1c6c516708"
    }
  },
  "meta": {}
}

*/

/*

var MODEL = {
  id: "",               // Calendar Item ID (uuid)
  type: "calendarItem", // Data model name
  name: "",             // Display name of the calendar item
  notes: "",            // User notes
  at: "",               // ISO Timestamp (internally Date) if one time item.
  cron: "",             // 6 field cron format secs mins hours days weeks months
  durationSecs: 0,      // Set > 0 to trigger sending of the endApi
  tags: [],             // Array of string tags for classification
  api: {
    url: "",            // API URL within the site
    method: "",         // API method (default GET)
    headers: {},        // Custom headers
    body: {},           // Body to send for PUT/POST
  },
  endApi: {},           // Same structure as api, set only if durationSecs is used to send
  links: {
    runAs: {}           // User that this API item will be run by.
  },
  meta: {},
}

*/

// Initialize cron for calendar items
calendar.init = async function() {
  if (_.size(cronEntries) > 0) {throw new HttpError[500]('Only initialize calendars once per process');}

  // Restore outstanding calendarEnds
  calendarEnds = await Singleton.loadSingleton('calendar-ends');
  _.each(calendarEnds.data, function(endStamp, itemId) {
    var msFromNow = endStamp - Date.now();
    setTimeout(function() {
      calendar.fireItem(itemId, true);
    }, msFromNow)
  })

  // Start up each calendar item
  let items = await CalendarItem.all();
  _.each(items, calendar.startItem);
  console.log('Scheduling ' + _.size(cronEntries) + ' calendar items');
}

calendar.startItem = function(item) {
  if (cronEntries[item.id]) {
    calendar.stopItem(item);
  }

  // AT vs. CRON processing
  let cronTime;
  if (item.at) {
    // AT processing - item.at is an ISO date
    cronTime = new Date(item.at);

    // See if AT time is in the past
    let msTillItem = cronTime.getTime() - Date.now();
    if (msTillItem < 0) {
      if (msTillItem + TARDY_MS > 0) {
        // Within the TARDY window - kick it off in 5 seconds
        cronTime = new Date(Date.now() + 5000);
      }
      else {
        console.error('Calendar Item scheduled in the past. Not running: ' + item.id + ' - ' + item.name);
      }
    }
  }
  else if (item.cron) {
    // CRON processing - item.cron must be a valid cron time
    cronTime = item.cron;
  }
  else {
    console.error('No at or cron entry in calendar item: ' + item.id + ' - ' + item.name);
  }

  // Initialize the cron entry
  let cronEntry = cronEntries[item.id] = new CronJob({
    cronTime: cronTime,
    onTick: calendar.fire,
    unrefTimeout: true
  })
  cronEntry.calendarItemId = item.id;
  cronEntry.start();
}

calendar.stopItem = function(item) {
  let cronEntry = cronEntries[item.id];
  if (cronEntry) {
    cronEntry.stop();
  }
  delete cronEntries[item.id];
}

calendar.fire = async function() {
  var t = this; // this == the cronEntry
  try {
    return await calendar.fireItem(t.calendarItemId, false);
  }
  catch(e) {
    console.error('Error while firing calendar item: ' + this.id, e);
  }
}

// Fire the specified calendar item - placing it onto the databus
// isEnd - is this an End event from durationSecs > 0?
calendar.fireItem = async function(itemId, isEnd) {

  let item = await CalendarItem.load(itemId);

  // Cleanup if it's a scheduled end
  if (isEnd) {
    delete calendarEnds.data[itemId];
    await calendarEnds.save();

    // Validate the end is available
    if (!item.apiEnd || !item.apiEnd.url) {
      console.error("Calendar has a duration but no end api: " + item.id + ' - ' + item.name);
      return;
    }
  }

  // Make sure the calendar item can be run as a user
  let runAsUserId = _.get(item, "links.runAs.href", "/").split('/')[1];
  if (!runAsUserId) {
    console.error("Calendar has no runAs user: " + item.id + ' - ' + item.name);
    return;
  }

  // Build the url
  let api = isEnd ? item.endApi : item.api;
  var siteUrl = api.url;
  if (!siteUrl) {
    console.error("Calendar API has no url: " + item.id + ' - ' + item.name);
    return;
  }
  if (siteUrl.substr(0,1) != "/") {
    siteUrl = "/" + siteUrl;
  }
  if (siteUrl.substr(0,6) == "/site/") {
    // remove /site/{id}
    let parts = siteUrl.split('/');
    parts.splice(1,2);
    siteUrl = parts.join('/');
  }

  // Make the API call and disregard the response
  let rqConfig = {
    url: "http://localhost:" + config['iot-edge'].get('server.port') + siteUrl,
    method: api.method || "GET",
    body: api.body || null,
    headers: api.headers || {}
  }
  rqConfig.headers.Cookie = 'userId=' + runAsUserId;
  if (rqConfig.body && !_.isString(rqConfig.body)) {
    rqConfig.body = JSON.stringify(rqConfig.body);
  }
  if (rqConfig.body && rqConfig.body.substr(0,1) === '{') {
    rqConfig.headers['content-type'] = 'application/json';
  }
  await Request(rqConfig);

  // Schedule the end trigger if necessary
  if (item.durationSecs > 0 && !isEnd) {
    var endStamp = Date.now() + (item.durationSecs * 1000);
    calendarEnds.data[itemId] = endStamp;
    await calendarEnds.save();
    var msFromNow = endStamp - Date.now();
    setTimeout(function() {
      calendar.fireItem(itemId, true);
    }, msFromNow)
  }

  // Remove the calendar item if it's an AT type and no more processing needed
  if (!item.cron && ((item.durationSecs == 0) || (item.durationSecs > 0 && isEnd))) {
    console.log('Calendar Item FIRE AND FORGET job forgotten: ' + JSON.stringify(item));
    await item.delete();
  }

}

// Get a calendar item by ID
calendar.getItem = async function(request, response) {
  let id = request.getParams({url:['id']}).id;
  let item = await CalendarItem.load(id);
  response.send(item);
}

// Get all calendar items (filtered by tags=tag1,tag2,tag3)
calendar.getItems = async function(request, response) {
  let tags = request.getParams({url:['*tags']}).tags;
  let items = await CalendarItem.all()

  // If tags requested, return items containing all tags
  if (tags) {
    let allTags = tagsParam.split(',');
    items = _.filter(items, function(item) {
      return _.intersection(allTags, item.tags).length == allTags.length;
    })
  }

  response.send(items);
}

/**
 * Sanitize the input form.
 *
 * This defaults, translates, throws exceptions on error, and returns a sanitized resource
 */
calendar.sanitizeInput = async function(request) {

  let fields = [
    '*id','*type','*name','*notes','*at', '*cron', '*durationSecs',
    '*tags', '*api', '*endApi', '*links', '*meta'
  ]
  let body = request.getParams({url:fields, body:fields});

  // Default some fields
  body.id = body.id || "";
  body.type = body.type || "calendarItem";
  body.name = body.name || "";
  body.notes = body.notes || "";
  body.durationSecs = body.durationSecs ? +body.durationSecs : 0;
  if (!body.api || !body.api.url) {
    throw HttpError.BadRequest('API URL must be specified');
  }
  if (body.durationSecs > 0 && (!body.endApi || !body.endApi.url)) {
    throw HttpError.BadRequest('End API must be specified on items with a duration');
  }

  // Allow tags specified as an array or as a comma separated string
  body.tags = body.tags || [];
  body.tags = _.isArray(body.tags) ? body.tags : body.tags.split(',');

  // One of at or cron must be specified
  if (!body.at && !body.cron) {
    throw HttpError.BadRequest('Must specify either an at or cron time');
  }

  // Force the runAs as the authenticated user making the request
  body.links = body.links || {};
  body.links.runAs = {
    name: request.user.name,
    href: 'users/' + request.user.id
  }

  return body;
}

// Post a calendar item
calendar.postItem = async function(request, response) {
  let item = await calendar.sanitizeInput(request);
  if (item.id) {
    throw new HttpError.BadRequest('Cannot specify an ID on POST: ' + item.id);
  }
  item = new CalendarItem(item);
  await item.save();
  calendar.startItem(item);
  return response.send(item);
}

// Put a calendar item
calendar.putItem = async function(request, response) {
  let newItem = await calendar.sanitizeInput(request);
  let item;
  try {
    item = await CalendarItem.load(newItem.id);
  }
  catch (e) {
    throw new HttpError.NotFound('Item ' + newItem.id + ' not found.');
  }
  // Completely overwrite the old item
  item = new CalendarItem(newItem);
  await item.save();
  calendar.startItem(item);
  return response.send(item);
}

// Delete a calendar item
calendar.deleteItem = async function(request, response) {
  var id = request.getParams({url:['id']}).id;
  try {
    item = await CalendarItem.load(id);
    calendar.stopItem(item);
  } catch(e) {}
  await CalendarItem['delete'](id);
  response.send('deleted');
}

// Routing table
calendar.get('/calendar', AuthC.api, calendar.getItems)
calendar.get('/calendar/:id', AuthC.api, calendar.getItem)
calendar.post('/calendar', AuthC.api, AuthZ.role('controller'), calendar.postItem)
calendar.put('/calendar/:id', AuthC.api, AuthZ.role('controller'), calendar.putItem)
calendar['delete']('/calendar/:id', AuthC.api, AuthZ.role('controller'), calendar.deleteItem)
