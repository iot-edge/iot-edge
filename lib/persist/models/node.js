/**
 * A mc node in the cloud
 *
 */
var Base = require('./base');

var MODEL = {
  id: "",            // Public IP Address
  type: "node",      // Data model name
  name: "",          // Node hostname
  health: "unknown", // unknown, passing, failing
  privateIP: "",     // Inside IP address
  links: {
    tunnels:[]       // Tunnels open in this node (name=":nodePort")
  },
  meta: {}
}

/**
 * Constructor
 *
 * @param instance {Object} The raw JS object to instantiate this from
 */
var node = module.exports = function(instance) {

  var t = this;
  if (!t instanceof node) {
    return new node(instance);
  }

  // Call parent constructor
  node.super_.call(t, 'node', instance);

}
require('util').inherits(node, Base);
var proto = node.prototype;

// Expose statics to base
Base.models.node = MODEL;
Base.classes.node = node;
['load','loadIndexed','loadByHref','delete','all'].forEach(function(methodName) {
  node[methodName] = function() {return Base[methodName](MODEL.type, arguments);}
})
