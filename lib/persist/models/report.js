/**
 * Report definition
 */
var Base = require('./base');

var MODEL = {
  id: "",            // Report ID (slug)
  type: "report",    // Data model name
  name: "",          // Display name of the report definition
  queries: {},       // Named queries key=slug value=data-source-specific-query.
                     // Example for dashboard query ("default" is used if none specified):
                     // "default": {
                     //   title: "Alert Dashboard",
                     //   dashName: "alerts",
                     //   dashUuid: null,
                     //   screenWidth: 1024,
                     //   from: "now-24h",
                     //   to: "now",
                     //   theme: "light",
                     //   extraUrlParams: "",
                     //   hideHeading: false,
                     //   sendTo: [
                     //     "user/d40bb2d4-1547-4e75-ada6-0a1c6c516708",
                     //     "user/643b00b9-5942-4408-a1ab-f34a8ac85902"
                     //   ]
                     // }
  history: [],       // List of S3 persisted reports. Each history entry looks like this:
                     // TODO: Move this into a 3-table indexed db (report_run, report_tagmap, report_tags)
                     //       Following is for an AND tag select:
                     //       SELECT rr.*
                     //       FROM report_run rr, report_tagmap tm
                     //       WHERE rr.report_id = {this_report_id}
                     //       AND rr.id = tm.run_id
                     //       AND (tm.tag IN ('tag_1', 'tag_2', 'tag_3'))
                     //       GROUP BY rr.id
                     //       HAVING COUNT( rr.id )=3 // must have all 3 tags. Remove this line for an OR
                     // {
                     //   id: "report-uu-id",
                     //   title: "Report Title",
                     //   tags: [], (optional - for organizing history items)
                     //   query: {"actual":"query that ran"},
                     //   format: "pdf",
                     //   runDate: "...Z",
                     //   runBy: "run-by-user-uu-id",
                     //   retainUntil: "...Z",
                     //   url: "https://private.microclimates.com/mcxz/reports/report-uu-id"
                     // }
  links: {
    runners: [],     // List of users/groups authorized to view/run the report
    editors: [],     // List of users/groups authorized to edit the report
    schedules: [],   // List of CalendarItems used for scheduled report running
  },
  meta: {}
}

/**
 * Constructor
 *
 * @param instance {Object} The raw JS object to instantiate this from
 */
var report = module.exports = function(instance) {

  var t = this;
  if (!t instanceof report) {
    return new report(instance);
  }

  // Call parent constructor
  report.super_.call(t, 'report', instance);

}
require('util').inherits(report, Base);
var proto = report.prototype;

// Expose statics to base
Base.models.report = MODEL;
Base.classes.report = report;
['load','loadIndexed','loadByHref','delete','all'].forEach(function(methodName) {
  report[methodName] = function() {return Base[methodName](MODEL.type, arguments);}
})
