/**
 * Storage for the last generated ID for model instances
 *
 * Generally model instance IDs are uuids which are safe to generate
 * on any client. Sometimes you want an ascending number or mc-tiny-id
 * for your identifiers.
 *
 * Instances of this model contain the last numeric ID generated for
 * data model instances (where id=data model name).
 *
 * This relies either on luck, or an underlying semaphore mechanism.
 */
var Base = require('./base');

var MODEL = {
  id: "",            // The namespace for ID generation - usually a model name
  type: "lastId",    // Data model name
  lastId: 2817,      // The last ID generated
  links: {},
  meta: {}
}

/**
 * Constructor
 *
 * @param instance {Object} The raw JS object to instantiate this from
 */
var lastId = module.exports = function(instance) {

  var t = this;
  if (!t instanceof lastId) {
    return new lastId(instance);
  }

  // Call parent constructor
  lastId.super_.call(t, 'lastId', instance);

}
require('util').inherits(lastId, Base);
var proto = lastId.prototype;

// Expose statics to base
Base.models.lastId = MODEL;
Base.classes.lastId = lastId;
['load','loadIndexed','loadByHref','delete','all'].forEach(function(methodName) {
  lastId[methodName] = function() {return Base[methodName](MODEL.type, arguments);}
})

// Wait on a unique lock for this namespace
proto.lock = function() {
}
