/**
 * Browser session - an association of browser/cookie with a user
 *
 * The goal with sessions is to make them seem forever, yet allow for 
 * garbage collection. After a long timeout (3 of months inactivity)
 * they can be considered inactive and garbage collected.
 *
 * The router will refresh the expiration date \\
 */
var Base = require('./base');
var SESSION_TIMEOUT_MS = 1000 * 60 * 60 * 24 * 90

var MODEL = {
  id: "",             // Session ID (stored in mc_secure_session http-only cookie)
  type: "session",    // Data model name
  created: "",        // Created date
  expires: "",        // Expiration date
  ipAddress: "",      // Coming in on IP address
  userAgent: "",      // UA string
  links: {
    user: {},         // Link to the user
  },
  meta: {}
}

/**
 * Constructor
 *
 * @param instance {Object} The raw JS object to instantiate this from
 */
var session = module.exports = function(instance) {

  var t = this;
  if (!t instanceof session) {
    return new session(instance);
  }

  // Call parent constructor
  session.super_.call(t, 'session', instance);
}
require('util').inherits(session, Base);
var proto = session.prototype;

// Expose statics to base
Base.models.session = MODEL;
Base.classes.session = session;
['load','loadIndexed','loadByHref','delete','all'].forEach(function(methodName) {
  session[methodName] = function() {return Base[methodName](MODEL.type, arguments);}
})

// Triggers
proto.afterLoad = function() {
  var t = this;
  if (t.created) {
    t.created = new Date(t.created)
  }
  if (!t.created) {
    t.created = new Date()
  }
  if (t.expires) {
    t.expires = new Date(t.expires)
  }
  if (!t.expires) {
    t.expires = new Date(t.created.getTime() + SESSION_TIMEOUT_MS)
  }
}
proto.beforeSave = function() {
  var t = this;
  if (!t.created) {
    t.created = new Date()
  }
  if (!t.expires) {
    t.expires = new Date(t.created.getTime() + SESSION_TIMEOUT_MS)
  }
}
