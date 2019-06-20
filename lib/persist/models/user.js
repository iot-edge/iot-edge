var Base = require('./base');
var md5 = require('md5');

/**
 * Constructor
 * 
 * Most user/group management is done in Grafana. This contains parallel user information.
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
  id: "",        // Grafana user ID
  type: "user",  // Data model name
  name: "",      // From Grafana
  login: "",     // From Grafana
  email: "",     // From Grafana
  role: "",      // From Grafana (in org1 or last logged in org)
  watches: [],   // List of owned alert watches (see models/watch)
  links: {
    menu: {},        // Link to a custom Menu for this user
    favChannels: []  // List of favorite channels
  },
  meta: {}
}

// Expose statics to base
Base.models.user = MODEL;
Base.classes.user = user;
['load','loadIndexed','loadByHref','delete','all'].forEach(function(methodName) {
  user[methodName] = function() {return Base[methodName](MODEL.type, arguments);}
})