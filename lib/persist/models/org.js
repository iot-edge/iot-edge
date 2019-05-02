/**
 * An organizational entity (unused)
 */
var Base = require('./base');

/**
 * Constructor
 *
 * @param instance {Object} The raw JS object to instantiate this from
 */
var org = module.exports = function(instance) {
  var t = this;
  if (!t instanceof org) { return new org(instance); }
  org.super_.call(t, 'org', instance);
}
require('util').inherits(org, Base);
var proto = org.prototype;

var MODEL = {
  id: "",
  type: "org",
  name: "",           // Organization name
  roles: [],          // Array of org role enums: ['owner','var','manufacturer']
  links: {
    parent: {},       // Parent org for hierarchical definitions
    members: [],      // Organization members (employees, etc.) name=userId
    hubs: [],         // Hubs this organization manages name=hubId
  },
  meta: {}
}

// Expose statics to base
Base.models.org = MODEL;
Base.classes.org = org;
['load','loadIndexed','loadByHref','delete','all'].forEach(function(methodName) {
  org[methodName] = function() {return Base[methodName](MODEL.type, arguments);}
})
