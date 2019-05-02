var Base = require('./base');
var md5 = require('md5');

/**
 * Constructor
 *
 * @param instance {Object} The raw JS object to instantiate this from
 */
var user = module.exports = function(instance) {
  var t = this;
  if (!t instanceof user) { return new user(instance); }
  user.super_.call(t, 'user', instance);
}
require('util').inherits(user, Base);
var proto = user.prototype;

var MODEL = {
  id: "",            // Unique user id.
  type: "user",      // Data model name
  firstName: "",     // First name
  lastName: "",      // Last name
  email: "",         // Email address
  phone: "",         // Primary mobile number
  roles: "",         // hub: One of 'guest monitor controller admin owner' server: roles
  avatarUrl: "",     // User avatar URL

  // Hub only
  grafanaId: 0,      // Grafana user ID
  watches: [],       // List of owned alert watches (see models/watch)

  links: {
    menu: {},        // Link to a custom Menu for this user (site only)
    favChannels: []  // List of favorite channels (site only)
  },
  meta: {}
}

// Expose statics to base
Base.models.user = MODEL;
Base.classes.user = user;
['load','loadIndexed','loadByHref','delete','all'].forEach(function(methodName) {
  user[methodName] = function() {return Base[methodName](MODEL.type, arguments);}
})

// Define indexes
user.indexes = {
  email: 'idxEmail',
  phone: 'idxPhone',
}

// Triggers
proto.afterLoad = function() {
  var t = this;

  t.links.hubs.forEach(function(hubLink) {
    var meta = hubLink.meta;
    if (meta && meta.expires) {
      meta.expires = new Date(meta.expires);
    }
  })

  if (!t.links.apiToken) {
    t.links.apiToken = {}
  }
  if (!t.links.favChannels) {
    t.links.favChannels = []
  }
  if (t.prCodeExpires) {
    t.prCodeExpires = new Date(t.prCodeExpires);
  }
}
proto.beforeSave = function() {
  var t = this;
  if (t.prCodeExpires && Date.now() > t.prCodeExpires.getTime()) {
    t.prCode = '';
    t.prCodeExpires = '';
  }
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

proto.buildGravatarUrl = function(emailAddress) {
  var t = this
  var hash = md5(t.email.trim().toLowerCase());
  return 'https://www.gravatar.com/avatar/' + hash + '?d=identicon';
}

