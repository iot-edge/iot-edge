/**
 * A product line definition
 *
 * Products are identified by their NPM module name.
 * More information is found in the product.json file of the module
 */
var Base = require('./base');

var MODEL = {
  id: "",            // Product ID (NPM package.json name)
  type: "product",   // Data model name
  name: "",          // Display name (NPM package.json description)
  manufacturer: "",  // Product manufacturer
  version: null,     // Installed package version. Put 'latest' to check/install latest
  newDeviceName: "", // Default new device name 
  deviceDashSlug: "",// Dashboard slug for the main device dashboard (named device.json)
  connectPanelId: "",// ID of the device on-boarding connection panel
  installer: "",     // New device installer (library under mc-hub/lib/installers) homie,foscam,soft (software device)
  url: "",           // Manufacturer's product url
  defaultConfig: {}, // Default configurations (from product package.json)
  defaultLimits: {}, // Default gauge/alert limits
  links: {
    devices: []      // Installed devices of this product type. Name=device.metricKey
  },
  meta: {}
}

/**
 * Constructor
 *
 * @param instance {Object} The raw JS object to instantiate this from
 */
var product = module.exports = function(instance) {

  var t = this;
  if (!t instanceof product) {
    return new product(instance);
  }

  // Call parent constructor
  product.super_.call(t, 'product', instance);

}
require('util').inherits(product, Base);
var proto = product.prototype;

// Expose statics to base
Base.models.product = MODEL;
Base.classes.product = product;
['load','loadIndexed','loadByHref','delete','all'].forEach(function(methodName) {
  product[methodName] = function() {return Base[methodName](MODEL.type, arguments);}
})
