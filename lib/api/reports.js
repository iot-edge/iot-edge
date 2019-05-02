const Router = require('express-promise-router')
const Request = require('request-promise')
const Hub = require('../persist').Hub;
const Report = require('../persist').Report;
const ServicePlan = require('../persist').ServicePlan;
const User = require('../persist').User;
const puppeteer = require('puppeteer');
const Group = require('../persist').Group;
const reports = module.exports = Router()
const groups = require('./groups');
const HttpError = require('httperrors')
const AuthC = require('../authenticate');
const AuthZ = require('../authorize');
const Dashboard = require('../dashboard');
const CDN = require('./cdn');
const uuid = require('uuid');
const mime = require('mime');
const send = require('send')
const _ = require('lodash');
const fs = require('fs-magic');
const ONE_DAY = 1000 * 60 * 60 * 24;

/**
 * Gather all report input params.
 *
 * All params are optional except the :reportId url path param
 *
 *  reportId - Must be valid and provided in the url param
 *  title: Report title available for templates
 *  from: timestamp for the report to run from
 *  to: timestamp for the report to run to
 *  runBy: ID of the user this report is run by (obtained from request)
 *  queryName: Named report query to use
 *  query: Object to use instead of (or to override) named query
 *  format: pdf,png,html,csv,other (not all available for all report types)
 *  retainDays: 20 (retain the output and reply w/url vs. the actual output)
 *  sendTo: An array or a comma separated string of "user/{id},group/{id},..."
 *
 *  Seems like a lot considering query can be deep and change per report,
 *  but with good defaults many reports can run without any parameters.
 *
 *  SHORTCUT: All url based query parameters not listed above will be placed into the query object.
 *
 *  Input: request object
 *  Output: above params
 */
reports.gatherReportRunParameters = async function(request) {
  var knownParams = ["*title", "*from", "*to", "*queryName", "*query", "*format", "*retainDays", "*sendTo"];
  var params = request.getParams({path:['reportId'], body: knownParams, query: knownParams});
  var report = request.report;

  // Parse a JSON stringified query (usually because passed as an url param)
  if (params.query && _.isString(params.query) && params.query.substr(0,1) == '{') {
    params.query = JSON.parse(params.query);
  }

  // Shortcut: Place unknown url params into params.query
  params.query = params.query || {};
  for (var qName in request.query) {
    if (! _.find(knownParams, function(knownParamName) {
      return qName == knownParamName.substr(1);
    })) {
      params.query[qName] = request.query[qName];
    }
  }

  // Validate and merge named query items
  if (params.queryName) {
    var namedQuery = report.queries[params.queryName];
    if (!namedQuery) {
      throw new HttpError.BadRequest('Named query "' + params.queryName + '" not found');
    }
    _.defaults(params.query, namedQuery);
  }

  // Merge default query parameters if available
  if (report.queries['default']) {
    _.defaults(params.query, report.queries['default']);
  }

  // Default the output format
  params.format = params.format || 'pdf';

  // Validate retention days
  if (params.retainDays) {
    params.retainDays = +params.retainDays;
    let servicePlan = await ServicePlan.loadSingleton();
    if (params.retainDays < 1) {
      throw new HttpError.BadRequest('Retain days must be a positive integer.');
    }
    let maxDays = ServicePlan.numDays(servicePlan.reportRetention);
    if (params.retainDays > maxDays) {
      throw new HttpError.BadRequest('Retain days cannot exceed maximum (' + maxDays + ').');
    }
  }

  // Sent reports must be retained in the CDN
  if (params.sendTo && !params.retainDays) {
    params.retainDays = ServicePlan.numDays(servicePlan.reportRetention);
  }

  // Hardcode the runBy as the user requesting the report
  params.runBy = request.user.id;

  return params;
}

// This provides a minimum object based on the input parameters
// Only required input parameter is reportId in the url
reports.sanitizeInput = async function(request) {
  var params = request.getParams({path:['reportId'], body:['*name','*scheduling','*queries','*history','*links','*meta']});
  var report = new Report(reportId);
  report.name = params.name || null;
  report.scheduling = params.scheduling || null;
  report.queries = params.queries || null;
  report.history = params.history || null;
  report.links = params.links || null;
  report.links.runners = params.links.runners || null;
  report.links.editors = params.links.editors || null;
  report.meta = params.meta || null;
}

// Authorization middleware
reports.canRunReport = async function(request, response, next) {
  var reportId = request.getParams({path:['reportId']}).reportId;
  request.report = request.report || await Report.load(reportId);
  AuthZ.verifyUserGroupAuth(request.user.id, request.report.links.runners);
  next();
}
reports.canEditReport = async function(request, response, next) {
  var reportId = request.getParams({path:['reportId']}).reportId;
  request.report = request.report || await Report.load(reportId);
  AuthZ.verifyUserGroupAuth(request.user.id, request.report.links.editors);
  next();
}

// Return the list of report definitions
reports.getList = async function(request, response) {

  let allReports = await Report.all();

  // Filter unauthorized reports
  for (var reportId in allReports) {
    var report = allReports[reportId];
    if (!(await AuthZ.isUserGroupAuthorized(request.user.id, report.links.runners))) {
      delete allReports[reportId];
    }
  }

  return response.send(_.values(allReports));
}

// Request a report definition
reports.getReport = async function(request, response) {
  response.send(report);
}

// Save a report
reports.putReport = async function(request, response) {
  // See if it's an add or an update
  var report = await report.sanitizeInput(request);

  // Merge into prior model if necessary
  var priorModel;
  try {
    priorModel = await Report.load(report.id);
  }
  catch(e) {}
  if (priorModel) {
    report.scheduling = report.scheduling || priorModel.scheduling;
    report.queries = report.queries || priorModel.queries;
    report.history = report.history || priorModel.history;
    report.links.runners = report.links.runners || priorModel.links.runners;
    report.links.editors = report.links.editors || priorModel.links.editors;
    report.meta = report.meta || priorModel.meta;
  }

  // Persist and return
  await report.save();
  response.send(report);
}

// Remove a report
reports.deleteReport = async function(request, response) {
  var reportId = request.getParams({path:['reportId']}).reportId;
  await Report.delete(reportId);
  response.send('deleted');
}

// Prepare the report from an inbound request
reports.runReportFromRequest = async function(request, response) {
  let runParams = await reports.gatherReportRunParameters(request);
  let run = await reports.runReport(runParams);

  // If no destination, send report to response. Otherwise send CDN path.
  if (run.cdnUrl) {
    response.send({url:run.cdnUrl});
  }
  else {
    send(request, run.tmpPath).pipe(response);
  }
}


// This generates the report, sending the output to the
// destination specified in runParams. The following object
// is returned:
// {
//   tmpPath: "/full/filename", // Path to the report - will be removed in 60 seconds
//   cdnUrl: "https://.."       // If persisted to the CDN, this is the URL
// }
reports.runReport = async function(runParams) {
  let fsDir = '/mnt/edge/fs';
  let fsPath = '/report/tmp';
  let uid =  uuid.v4();
  let tmpFile =  uid + '.' + runParams.format;
  let tmpDir = fsDir + fsPath;
  let tmpPath = tmpDir + '/' + tmpFile;
  let cdnUrl = null;
  await fs.mkdirp(tmpDir, 0o777, true);

  // Gather report content into a file
  if (runParams.reportId == 'dashboard') {
    await reports.runDashboardReport(tmpPath, runParams);
  }
  else if (runParams.reportId == 'panel') {
    await reports.runPanelReport(tmpPath, runParams);
  }
  else {
    await reports.runNodeRedReport(tmpPath, runParams);
  }

  // Retain the report in the CDN?
  if (runParams.retainDays) {

    // Send output to the CDN, record and output the URL
    let servicePlan = await ServicePlan.loadSingleton();
    let cdnPath = 'report/' + runParams.reportId;
    let fsFile = fsPath + '/' + tmpFile;
    let s3UploadParams = {
      ACL: 'public-read',
      StorageClass: 'STANDARD_IA',
      Tagging: "retention=" + servicePlan.reportRetention
    };
    let remove = true;
    cdnUrl = await CDN.uploadFile(cdnPath, fsFile, s3UploadParams, remove);
    let report = await Report.load(runParams.reportId);
    let retainUntil = new Date(Date.now() + (runParams.retainDays * ONE_DAY));
    report.history.push({
      id:uid,
      title:runParams.title,
      query:runParams.query,
      format:runParams.format,
      runDate:(new Date()).toISOString(),
      retainUntil:retainUntil.toISOString(),
      url: cdnUrl,
    })
    await report.save();
    if (runParams.sendTo) {
      await reports.sendTo(cdnUrl, runParams);
    }
  }

  return {tmpPath:tmpPath, cdnUrl:cdnUrl};
}

// Send the report to a distribution list
reports.sendTo = async function(cdnUrl, runParams) {
  let userIds = await groups.resolveUserIds(runParams.sendTo);
  let sendBody = {
    subject: runParams.title,
    html: 'The <i>' + runParams.title + '</i> report has been generated and is now available.',
    text: 'The ' + runParams.title + ' report has been generated and is now available.',
    ctaText: 'View Report',
    ctaUrl: cdnUrl,
    userIds: userIds
  };
  let opts = {
    url: 'https://microclimates.com/account/notify/' + process.env.SITE_ID,
    method: 'POST',
    headers: {
      'Authorization': 'Bearer ' + process.env.auth_token,
      'Content-Type' : 'application/json'
    },
    body: JSON.stringify(sendBody)
  }
  await Request(opts);
}

// Authenticate the browser for a report run
reports.authenticateBrowser = async function(page, runParams) {
  const hub = await Hub.loadSingleton();
  const user = await User.load(runParams.runBy);
  var cookie = [
        {
            "name": "__mc_user", "value": "Report|" + hub.id + "+" + encodeURIComponent(hub.name) + "+0+1",
            "id": 1, "path": "/", "sameSite": "no_restriction", "secure": false, "session": false, "storeId": "0",
            "domain": "nginx", "expirationDate": 1797288045, "hostOnly": false, "httpOnly": false, 
        },
        {
            "name": "userId", "value": user.id,
            "id": 1, "path": "/", "sameSite": "no_restriction", "secure": false, "session": false, "storeId": "0",
            "domain": "nginx", "expirationDate": 1797288045, "hostOnly": false, "httpOnly": false, 
        }
  ]
  await page.setCookie(...cookie)

  // Grafana auth is via headers
  await page.setExtraHTTPHeaders({
    'X-WEBAUTH-USER': user.email,
  })

}

// Drive a dashboard report
// Query:
//   dashName - dashboard Name (old - used without dashUuid)
//   dashUuid - dashboard UUID (new - used without dashName) 
//   width - Page width (height is auto generated)
//   theme - light or dark
//   hideHeading - present w/value or absent
//   from - From time (grafana from format)
//   to - To time (grafana to format)
//   extraUrlParams - URL params for the dashboard
reports.runDashboardReport = async function(tmpPath, runParams) {
  const browser = await puppeteer.launch({headless: true, args:['--no-sandbox']});
  const page = await browser.newPage();
  const hub = await Hub.loadSingleton();
  let query = runParams.query;
  let width = +query.width || 1024;
  if (!runParams.title) {
    runParams.title = 'Dashboard - ' + query.dashName;
  }

  await reports.authenticateBrowser(page, runParams);

  // Set a short height, then expand it when we discover the inner div height
  await page.setViewport({width:width, height:100});

  // Build the dash url
  let url = 'http://nginx/' + hub.id;
  if (query.dashUuid) {
    url += '/d/' + query.dashUuid + '/' + query.dashName;
  }
  else if (query.dashName) {
    url += '/dashboard/db/' + query.dashName;
  }
  else {
    url += '/';
  }
  url += '?orgId=1&theme=' + (query.theme || 'light');
  url += '&kiosk' + (query.hideHeading ? '' : '=tv');
  if (query.from) {
    url += '&from=' + query.from;
  }
  if (query.to) {
    url += '&to=' + query.to;
  }
  if (query.extraUrlParams) {
    url += '&' + query.extraUrlParams;
  }

  // Load the page
  await page.goto(url, {waitUntil: 'networkidle0'});

  // Compute the page height + width
  let height = await page.evaluate(async () => {
    let BOTTOM_MARGIN = 25;
    return $(".dashboard-container").height() + $(".navbar").height() + BOTTOM_MARGIN;
  });

  // Reset the viewport to the full page width
  await page.setViewport({width:width, height:height});

  await reports.generateOutputFile(tmpPath, page, null, height, runParams);
  await browser.close();
}

// Drive a single panel report
// Query:
//   dashName - dashboard Name (old - used without dashUuid)
//   dashUuid - dashboard UUID (new - used without dashName) 
//   panel - PanelID within the page (may need to view the dashboard JSON to find this)
//   width - Panel width
//   height - Panel height
//   theme - light or dark
//   hideHeading - present w/value or absent
//   from - From time (grafana from format)
//   to - To time (grafana to format)
//   extraUrlParams - URL params for the dashboard
reports.runPanelReport = async function(tmpPath, runParams) {
  const browser = await puppeteer.launch({headless: true, args:['--no-sandbox']});
  const page = await browser.newPage();
  const hub = await Hub.loadSingleton();
  await reports.authenticateBrowser(page, runParams);

  // Default some values
  let query = runParams.query;
  var width = +query.width || 1000;
  var height = +query.height || 500;
  var name = query.dashName;
  var uuid = query.dashUuid || await Dashboard.fetchUuidFromSlug(name);
  if (!runParams.title) {
    runParams.title = 'Dashboard - ' + query.dashName;
  }

  await page.setViewport({width:width, height:height});

  // Build the dash url
  let url = 'http://nginx/' + hub.id + '/d-solo/' + uuid + '/' + name;
  url += '?orgId=1&panelId=' + query.panel + '&theme=' + (query.theme || 'light');
  url += '&height=' + height + '&width=' + width;
  if (query.from) {
    url += '&from=' + query.from;
  }
  if (query.to) {
    url += '&to=' + query.to;
  }
  if (query.extraUrlParams) {
    url += '&' + query.extraUrlParams;
  }

  // Load the page
  await page.goto(url, {waitUntil: 'networkidle0'});

  await reports.generateOutputFile(tmpPath, page, width, height, runParams);
  await browser.close();
}

// Run a report that's been defined in node-red (using REST endpoints)
// Node-Red has two components:
// 1) Run a query and produce a report data model
reports.runNodeRedReport = async function(tmpPath, runParams) {
  const browser = await puppeteer.launch({headless: true, args:['--no-sandbox']});
  const page = await browser.newPage();
  const hub = await Hub.loadSingleton();
  await reports.authenticateBrowser(page, runParams);

  // Default some values
  let query = runParams.query;
  var width = +query.width || 1000;
  var height = +query.height || 500;
  var name = query.dashName;
  var uuid = query.dashUuid || await Dashboard.fetchUuidFromSlug(name);

  await page.setViewport({width:width, height:height});

  // Build the dash url
  let url = 'http://nginx/' + hub.id + '/d-solo/' + uuid + '/' + name;
  url += '?orgId=1&panelId=' + query.panel + '&theme=' + (query.theme || 'light');
  url += '&height=' + height + '&width=' + width;
  if (query.from) {
    url += '&from=' + query.from;
  }
  if (query.to) {
    url += '&to=' + query.to;
  }
  if (query.extraUrlParams) {
    url += '&' + query.extraUrlParams;
  }

  // Load the page
  await page.goto(url, {waitUntil: 'networkidle0'});

  await reports.generateOutputFile(tmpPath, page, width, height, runParams);
  await browser.close();
}

// This sends output from the browser to a file
reports.generateOutputFile = async function(tmpPath, page, width, height, runParams) {

  if (!width) {
    width = await page.evaluate(() => document.documentElement.offsetWidth);
  }
  if (!height) {
    height = await page.evaluate(() => document.documentElement.offsetHeight);
  }

  if (runParams.format == 'pdf') {
    await page.pdf({
      path: tmpPath,
      width: width + 'px',
      height: height + 'px',
      displayHeaderFooter: false,
      printBackground: true,
      pageRanges: '1-100',
    });
  }
  else if (runParams.format == 'png') {
    await page.screenshot({path: tmpPath});
  }
  else if (runParams.format == 'html') {
    let bodyHTML = await page.evaluate(() => document.body.innerHTML);
    await fs.writeFile(tmpPath, bodyHTML);
  }

}

// Routing table
reports.get ('/reports', AuthC.api, reports.getList);
reports.get ('/reports/:reportId', AuthC.api, reports.canRunReport, reports.getReport);
reports.put ('/reports/:reportId', AuthC.api, reports.canEditReport, reports.putReport);
reports.get ('/reports/run/:reportId', AuthC.api, reports.canRunReport, reports.runReportFromRequest);
reports.post('/reports/run/:reportId', AuthC.api, reports.canRunReport, reports.runReportFromRequest);
reports['delete']('/reports/:reportId', AuthC.api, reports.canEditReport, reports.deleteReport);
