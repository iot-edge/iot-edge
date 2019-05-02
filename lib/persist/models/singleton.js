/**
 * Singleton - named singletons of unstructured data
 *
 * These are stored with named IDs, assuming IDs are unique among a limited set of singletons. 
 */
var Base = require('./base');

var MODEL = {
  id: "",             // Generally determined by the module using the singleton
  type: "singleton",  // Data model name
  description: "",    // Where it's used, etc.
  data: {},           // Unstructured data associated with the singleton
  links: {},
  meta: {}
}

/**
 * Constructor
 *
 * @param instance {Object} The raw JS object to instantiate this from
 */
var singleton = module.exports = function(instance) {

  var t = this;
  if (!t instanceof singleton) {
    return new singleton(instance);
  }

  // Call parent constructor
  singleton.super_.call(t, 'singleton', instance);
}
require('util').inherits(singleton, Base);
var proto = singleton.prototype;

// Load the singleton, returning a new one (not persisted) if not found.
singleton.loadSingleton = async function(id) {
  var node;
  try {
    node = await singleton.load(id);
  }
  catch(e) {
    if (e.statusCode != 404) {throw e}
    // Create the first singleton
    node = new singleton({id:id});
  }
  return node;
}

// Expose statics to base
Base.models.singleton = MODEL;
Base.classes.singleton = singleton;
['load','loadIndexed','loadByHref','delete','all'].forEach(function(methodName) {
  singleton[methodName] = function() {return Base[methodName](MODEL.type, arguments);}
})
