/**
 * This is a handler listening for an event
 *
 * It's here for the API, as persistence is managed by the hub
 */
var Base = require('./base');

/**
 * Constructor
 *
 * @param instance {Object} The raw JS object to instantiate this from
 */
var eventHandler = module.exports = function(instance) {
  var t = this;
  if (!t instanceof eventHandler) { return new eventHandler(instance); }
  eventHandler.super_.call(t, 'eventHandler', instance);
}
require('util').inherits(eventHandler, Base);
var proto = eventHandler.prototype;

var MODEL = {
  id: "",
  type: "eventHandler",
  eventName: "",     // The origin namespaced event name. Example "temp_warn"
  handlerName: "",   // One of an enumeration of loaded event handlers
  params: {},        // Handler specific handler parameters
}

eventHandler.apiDoc = {
  description: "A handler that runs when an event fires",
  properties:{
    id: { type: 'string', description: 'The public eventHandler identifier', readOnly: true },
    type: { type: 'string', description: 'The resource type', readOnly: true },
    eventName: { type: 'string', description: 'The origin namespaced event name. Example: "temp_warn"' },
    handlerName: { type: 'string', description: 'One of an enumeration of loaded event handlers' },
    params: { type: 'object', description: 'Handler specific handler parameters', additionalProperties: true},
  },
  required: ['eventName','handlerName'],
  additionalProperties: false,
}

// Expose statics to base
Base.models.eventHandler = MODEL;
Base.classes.eventHandler = eventHandler;
['load','loadIndexed','loadByHref','delete','all'].forEach(function(methodName) {
  eventHandler[methodName] = function() {return Base[methodName](MODEL.type, arguments);}
})
