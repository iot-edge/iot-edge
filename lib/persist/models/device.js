/**
 * A registered device
 *
 * Devices are registered to get a unique ID and to associate
 * them with the hub they are running within.
 */
var Base = require('./base');

/**
 * Constructor
 *
 * @param instance {Object} The raw JS object to instantiate this from
 */
var device = module.exports = function(instance) {
  var t = this;
  if (!t instanceof device) { return new device(instance); }
  device.super_.call(t, 'device', instance);
}
require('util').inherits(device, Base);
var proto = device.prototype;

var MODEL = {
  id: "",            // Unique device ID (12 char mac address, less colons)
  type: "device",    // Data model name
  name: "",          // Display name
  metricKey: "",     // Data metric key (default: slugified display name)
  serialNumber: "",  // Assigned by the manufacturer (tinyId for mc devices)
  activated: null,   // Activation date ISO. To null to deactivate, from null to activate.
  dashSlug: null,    // Device dashboard slug
  options: {},       // Product options delivered with this device (defined by the product)
  config: {},        // Current device configuraions (defined by the product)
  calibrations: {},  // Device calibrations - specialized configs (defined by the product)
  limits: {},        // Gauge/Alert limits, keyed by limit name
  links: {
    product: {},     // The product that this device is one of
    zone: {},    // The primary zone this product resides (can be unset for software devices)
    hub:{}           // The hub the device is running within
  },
  meta: {}
}

// Expose statics to base
Base.models.device = MODEL;
Base.classes.device = device;
['load','loadIndexed','loadByHref','delete','all'].forEach(function(methodName) {
  device[methodName] = function() {return Base[methodName](MODEL.type, arguments);}
})
