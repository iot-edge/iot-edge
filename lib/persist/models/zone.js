/**
 * A zone within a hub
 *
 * Zones are user defined places that have devices installed
 */
var Base = require('./base');

/**
 * Constructor
 *
 * @param instance {Object} The raw JS object to instantiate this from
 */
var zone = module.exports = function(instance) {
  var t = this;
  if (!t instanceof zone) { return new zone(instance); }
  zone.super_.call(t, 'zone', instance);
}
require('util').inherits(zone, Base);
var proto = zone.prototype;

var MODEL = {
  id: "",            // Unique zone ID (uuid)
  type: "zone",  // Data model name
  name: "",          // Zone display name
  dashSlug: "",      // Grafana slug for the dashboard
  order: 0,          // Sort order among all zones for the hub. -1 for hidden zone.
  alertEmailTo: "",  // Space delimited list of emails to send on alert on/off
  alertSmsTo: "",    // Space delimited list of mobile numbers to send alert on/off
  links: {
    devices: [],     // Devices installed at this zone. name=':deviceId' (could be all numeric)
  },
  meta: {}
}

// Expose statics to base
Base.models.zone = MODEL;
Base.classes.zone = zone;
['load','loadIndexed','loadByHref','delete','all'].forEach(function(methodName) {
  zone[methodName] = function() {return Base[methodName](MODEL.type, arguments);}
})
