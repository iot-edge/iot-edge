/**
 * An oAuth access or refresh token for API access
 * Or a session token
 */
var Base = require('./base');

/**
 * Constructor
 *
 * @param instance {Object} The raw JS object to instantiate this from
 */
var token = module.exports = function(instance) {
  var t = this;
  if (!t instanceof token) { return new token(instance); }
  token.super_.call(t, 'token', instance);
}
require('util').inherits(token, Base);
var proto = token.prototype;

var MODEL = {
  id: "",             // oAuth token ID
  type: "token",      // Data model name
  realm: "Users",     // Resource protected "Hubs", "API" (apiToken), "Users", "Roles", "Capabilities"
  scopes: "",         // Authorized access for the resource "monitor control admin" space delim
                      // If realm=Roles, scopes=roles, if realm=Capabilities, scopes=capabilities
  notes:"",           // Notes about this token
  created: "",        // Created date
  expires: "",        // Expiration date
  links: {
    resource: {},     // The resource this realm applies to (or all if {})
    grantee: {},      // The user this token has been granted to (if to a user)
    grantor: {},      // The user this token was granted by (if a user)
    client: {},       // The oAuth client this token is authorized to be used on
  },
  meta: {}
}

token.apiDoc = {
  description: "An token representing a user or request authorization",
  properties:{
    id: { type: 'string', description: 'The public token identifier', readOnly: true },
    type: { type: 'string', description: 'The resource type', readOnly: true },
    realm: { type: 'string', description: 'Resource type being protected by this token' },
    scopes: { type: 'string', description: 'Space delimited list of authorized scopes' },
    notes: { type: 'string', description: 'User entered notes for manually created tokens' },
    created: { type: 'string', description: 'DateTime the token was created in ISO-8601 format' },
    expires: { type: 'string', description: 'DateTime this token expires in ISO-8601 format' },
    links: { type: 'object', description: 'Relationships to other resources', 
      properties: {
        resource: { description: 'The resource this realm applies to, or all if not specified',
          '$ref': '#/definitions/Link',
        },
        grantee: { description: 'The user that this token was granted to',
          '$ref': '#/definitions/Link',
        },
        grantor: { description: 'The user that this token was granted by',
          '$ref': '#/definitions/Link',
        },
        client: { description: 'The oAuth client this token is authorized to be used on',
          '$ref': '#/definitions/Link',
        },
      },
    },
    meta: { type: 'object', description: 'optional metadata', additionalProperties: true}
  },
  required: ['id','type','realm','scopes'],
  additionalProperties: false,
  'x-private': true
}

// Expose statics to base
Base.models.token = MODEL;
Base.classes.token = token;
['load','loadIndexed','loadByHref','delete','all'].forEach(function(methodName) {
  token[methodName] = function() {return Base[methodName](MODEL.type, arguments);}
})

// Triggers
proto.afterLoad = function() {
  var t = this;
  if (t.created) {
    t.created = new Date(t.created);
  }
  if (t.expires) {
    t.expires = new Date(t.expires);
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
