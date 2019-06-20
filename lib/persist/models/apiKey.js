var Base = require('./base');

/**
 * Constructor
 * 
 * Grafana API Key
 *
 * @param instance {Object} The raw JS object to instantiate this from
 */
var apiKey = module.exports = function(instance) {
  var t = this;
  if (!t instanceof apiKey) { return new apiKey(instance); }
  apiKey.super_.call(t, 'apiKey', instance);
}
require('util').inherits(apiKey, Base);
var proto = apiKey.prototype;

var MODEL = {
  id: "",         // Grafana ID for the apiKey
  type: "apiKey",  // Data model name
  name: "",       // From Grafana
  role: "",       // From Grafana
  links: {},
  meta: {}
}

// Expose statics to base
Base.models.apiKey = MODEL;
Base.classes.apiKey = apiKey;
['load','loadIndexed','loadByHref','delete','all'].forEach(function(methodName) {
  apiKey[methodName] = function() {return Base[methodName](MODEL.type, arguments);}
})