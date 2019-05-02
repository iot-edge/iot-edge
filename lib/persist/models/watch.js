var Base = require('./base');

/**
 * Alert Watch
 *
 * Not a persistence class - a data model attached to users/groups
 */
var watch = module.exports = function(instance) {

  var t = this;
  if (!t instanceof watch) { return new watch(instance); }

  t.name = "";               // Watch name
  t.action = "";             // Action to perform when this is triggered
  t.tags = [];               // Alert tags to watch (none=none)
  t.zone_id = '';            // Zone ID or '' for all zones
  t.zone_name = '';          // Zone Name
  t.days = "XXXXXXXXX";      // Notify days (0=sunday): X=notify blank=no notify
  t.start_time = "00:00";    // Notify window - start time
  t.end_time = "23:59";      // Notify window - end time
  t.repeat_every = "7d";     // Repeat alert notification every {time}{unit} unit=h/m/d

}
