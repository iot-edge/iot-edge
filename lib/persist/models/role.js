/**
 * An authorization role managed by a hub
 */
var Base = require('./base');

/**
 * Constructor
 *
 * @param instance {Object} The raw JS object to instantiate this from
 */
var role = module.exports = function(instance) {
  var t = this;
  if (!t instanceof role) { return new role(instance); }
  role.super_.call(t, 'role', instance);
}
require('util').inherits(role, Base);
var proto = role.prototype;

var MODEL = {
  id: "",
  type: "role",
  name: "",            // Role display name (link name will be camelCased)
  description: "",     // Role description - who is granted this role, what it's intentded for.
  extends: "",         // Name or href of the role that this extends
  capabilities: {},    // Capabilities for which this role grants authorization
                       // Name = capability name, value: space delimited resource IDs this capability authorizes
                       // Example: {invite:"guest monitor control", control:"*", dashboards:"dash1 dash2 dashgroup1"}
  links: {},
  meta: {}
}

role.apiDoc = {
  description: "The set of capabilities granted to users in this role",
  properties:{
    id: { type: 'string', description: 'The unique role identifier', readOnly: true },
    type: { type: 'string', description: 'The resource type', readOnly: true },
    name: { type: 'string', description: 'Role name' },
    extends: { type: 'string', description: 'Name or href of the role that this extends' },
    authorizations: { type: 'object', description: 'Hash of authorizations granted to people in this role. name:capabilityName, value:resources this capability applies to. Defined by the capability. "*" generally means all', 
      additionalProperties: true,
    },
    meta: { type: 'object', description: 'optional metadata', additionalProperties: true}
  },
  required: ['id','type','name','authorizations','links'],
  additionalProperties: false,
}

// Expose statics to base
Base.models.role = MODEL;
Base.classes.role = role;
['load','loadIndexed','loadByHref','delete','all'].forEach(function(methodName) {
  role[methodName] = function() {return Base[methodName](MODEL.type, arguments);}
})
