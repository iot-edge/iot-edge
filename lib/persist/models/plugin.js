/**
 * This represents an installed plugin
 *
 * Most plugin info is contained in the plugin package.json file 
 */
var Base = require('./base');

var MODEL = {
  id: "",            // Plugin ID (NPM package.json name)
  type: "plugin",    // Data model name
  uri: "",           // Plugin URL for more information
  author: "",        // Plugin author
  authorUri: "",     // URI of the author
  installTag: "prod",// The desired install distribution tag. "latest", "uat", "prod" are common install tags.
  version: "",       // Currently installed version
  updateVersion: "", // If specified, the version to install that brings up to date with the version tag
  autoUpdate: true,  // Automatically perform updates
  links: {},
  meta: {}
}

/**
 * Constructor
 *
 * @param instance {Object} The raw JS object to instantiate this from
 */
var plugin = module.exports = function(instance) {

  var t = this;
  if (!t instanceof plugin) {
    return new plugin(instance);
  }

  // Call parent constructor
  plugin.super_.call(t, 'plugin', instance);

}
require('util').inherits(plugin, Base);
var proto = plugin.prototype;

// Expose statics to base
Base.models.plugin = MODEL;
Base.classes.plugin = plugin;
['load','loadIndexed','loadByHref','delete','all'].forEach(function(methodName) {
  plugin[methodName] = function() {return Base[methodName](MODEL.type, arguments);}
})
