/**
 * Calendar Item 
 *
 * These stage the running of an inbound API call to this site
 *
 */
var Base = require('./base');

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
    headers: {},        // Custom headers (content-type auto set for POST w/body)
    body: {},           // Body to send for PUT/POST
  },
  endApi: {},           // Same structure as api, set only if durationSecs is used to send
  links: {
    runAs: {}           // User that this API item will be run as.
  },
  meta: {},
}

/**
 * Constructor
 *
 * @param instance {Object} The raw JS object to instantiate this from
 */
var calendarItem = module.exports = function(instance) {

  var t = this;
  if (!t instanceof calendarItem) {
    return new calendarItem(instance);
  }

  // Call parent constructor
  calendarItem.super_.call(t, 'calendarItem', instance);

}
require('util').inherits(calendarItem, Base);
var proto = calendarItem.prototype;

// Expose statics to base
Base.models.calendarItem = MODEL;
Base.classes.calendarItem = calendarItem;
['load','loadIndexed','loadByHref','delete','all'].forEach(function(methodName) {
  calendarItem[methodName] = function() {return Base[methodName](MODEL.type, arguments);}
})

// Triggers
proto.afterLoad = function() {
  var t = this;
  if (t.at) {
    t.at = new Date(t.at)
  }
}
