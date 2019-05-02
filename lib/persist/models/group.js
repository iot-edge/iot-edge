var Base = require('./base');

/**
 * Constructor
 *
 * @param instance {Object} The raw JS object to instantiate this from
 */
var group = module.exports = function(instance) {
  var t = this;
  if (!t instanceof group) { return new group(instance); }
  group.super_.call(t, 'group', instance);
}
require('util').inherits(group, Base);
var proto = group.prototype;

var MODEL = {
  id: "",            // Unique group id.
  type: "group",     // Data model name
  name: "",          // Group name
  description: "",   // Group description
  watches: [],       // List of owned alert watches (see models/watch)
  links: {
    users: []        // Group members
  },
  meta: {}
}

// Expose statics to base
Base.models.group = MODEL;
Base.classes.group = group;
['load','loadByHref','delete','all'].forEach(function(methodName) {
  group[methodName] = function() {return Base[methodName](MODEL.type, arguments);}
})
