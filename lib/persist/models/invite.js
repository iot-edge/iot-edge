/**
 * This is an invite given to a user
 */
var Base = require('./base');

/**
 * Constructor
 *
 * @param instance {Object} The raw JS object to instantiate this from
 */
var invite = module.exports = function(instance) {
  var t = this;
  if (!t instanceof invite) { return new invite(instance); }
  invite.super_.call(t, 'invite', instance);
}
require('util').inherits(invite, Base);
var proto = invite.prototype;

var MODEL = {
  id: "",
  type: "invite",
  firstName: "",     // First name
  lastName: "",      // Last name
  email: "",         // Email address
  phone: "",         // Primary mobile number
  role: "",          // Hub role (one of guest,monitor,controller,admin,owner)
  message: "",       // Custom message written by the invitedBy
  entryURL: "",      // The URL to go to after the invitation is accepted
  created: "",       // Created date
  durationMins: "",  // Invitation duration (in minutes)
  links: {
    user: {},        // The user being invited
    createdBy: {},   // The user this invite was created by
    hub: {},         // The hub this invite is for
    accessToken: {}, // The auth access token granting hub access
  },
  meta: {}
}

invite.apiDoc = {
  description: "An token representing a user or request authorization",
  properties:{
    id: { type: 'string', description: 'The public token identifier', readOnly: true },
    type: { type: 'string', description: 'The resource type', readOnly: true },
    firstName: { type: 'string', description: 'First name' },
    lastName: { type: 'string', description: 'Last name' },
    email: { type: 'string', description: 'Primary email address for login and notifications' },
    phone: { type: 'string', description: 'Primary mobile/sms number for login and notifications' },
    role: { type: 'string', description: 'Hub role enum (guest,monitor,controller,admin,owner)' },
    message: { type: 'string', description: 'User entered message' },
    entryURL: { type: 'string', description: 'The URL to go to after the invitation is accepted' },
    created: { type: 'string', description: 'DateTime the invite was created in ISO-8601 format' },
    durationMins: { type: 'integer', description: 'Invitation duration in minutes. If a guest, this is also when their guest token expires.' },
    links: { type: 'object', description: 'Relationships to other resources', 
      properties: {
        user: { description: 'The user being invited',
          '$ref': '#/definitions/Link',
        },
        accessToken: { description: 'The auth access token granting access',
          '$ref': '#/definitions/Link',
        },
        createdBy: { description: 'The user that this invite was created by',
          '$ref': '#/definitions/Link',
        },
        hub: { description: 'The hub this invite is for',
          '$ref': '#/definitions/Link',
        },
      },
    },
    meta: { type: 'object', description: 'optional metadata', additionalProperties: true}
  },
  required: ['firstName','role'],
  additionalProperties: false,
  'x-private': true
}

// Expose statics to base
Base.models.invite = MODEL;
Base.classes.invite = invite;
['load','loadIndexed','loadByHref','delete','all'].forEach(function(methodName) {
  invite[methodName] = function() {return Base[methodName](MODEL.type, arguments);}
})

// Triggers
proto.afterLoad = function() {
  var t = this;
  if (t.created) {
    t.created = new Date(t.created);
  }
}
proto.beforeSave = function() {
  var t = this;
  if (!t.created) {
    t.created = new Date();
  }
}

// Overrides
// 'resource' link used to be 'realm'
proto.origLoadLinked = Base.prototype.loadLinked
proto.loadLinked = function(rel) {
  var t = this
  if (rel === 'resource') {
    rel = t.links.realm ? 'realm' : rel
  }
  return t.origLoadLinked(rel)
}

// Helpers
proto.fullName = function() {
  var t = this
  var fullName = t.firstName
  if (t.lastName) {
    fullName += ' ' + t.lastName
  }
  return fullName
}

