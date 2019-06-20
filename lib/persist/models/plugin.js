/**
 * This represents an installed plugin
 *
 * Most plugin info is contained in the plugin package.json file 
 */
var Base = require('./base');

var MODEL = {
  id: "",             // Plugin ID (NPM package.json name)
  type: "plugin",     // Data model name
  pluginType: "",     // grafana, nodered, or edge
  npmRegistry: "",    // NPM Registry (defaults to https://registry.npmjs.org)
  tarballUrl: "",     // Tarball URL if installing from a tarball vs. npm
  tarballETag: "",    // ETag of the tarball (if installing from a tarball)
  installTag: "prod", // The desired install distribution tag. "latest", "uat", "prod" are common install tags.
  version: "",        // Currently installed version
  availableVersion:'',// Updated version available for installation
  autoUpdate: true,   // Automatically perform updates when requested
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
['load','loadByHref','delete','all'].forEach(function(methodName) {
  plugin[methodName] = function() {return Base[methodName](MODEL.type, arguments);}
})
