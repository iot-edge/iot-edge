/**
 * Site data model. This used to be called hub.
 */
var Base = require('./base');
var HttpError = require('httperrors');
var _ = require('lodash');

/**
 * Constructor
 *
 * @param instance {Object} The raw JS object to instantiate this from
 */
var hub = module.exports = function(instance) {
  var t = this;
  if (!t instanceof hub) { return new hub(instance); }
  hub.super_.call(t, 'hub', instance);
}
require('util').inherits(hub, Base);
var proto = hub.prototype;

var MODEL = {
  id: "",            // Unique hub id
  type: "hub",       // Data model name
  name: "",          // Hub advertised name
  health: "unknown", // Hub health: unknown, passing, failing

  grafanaPW: "",     // Grafana admin password
  wifiSSID: "",      // SSID - defaults to mc-hub-${hubId}
  wifiPW: "",        // Hub wifi password
  alt_wifiSSID: "",  // Alternate SSID (client side)
  alt_wifiPW: "",    // Alternate wifi password (client side)
  hubIP: "",         // Hub IP Address
  inviteRole: "",    // Allow "controller" or "monitor" roles to invite monitors?
  updateWindow: "",  // Software update window in 24 hour "hh:mm-hh:mm" format

  links: {
    auth_token: {},    // The hubs authToken into mc.com
    refresh_token: {}, // The hubs refreshToken into mc.com
    tunnels: [],       // Tunnels to various ports. name=":privatePort"
    account: {},       // The billing account (server side)
    servicePlan: {},   // Current service plan (site and server)
    roles: [],         // Roles this hub is managing (name=RoleName)
    users: [],         // List of authorized user accounts. name=userId
    owner: {},         // The user with hub ownership responsibility (presence signifies successful site onboarding)
  },
  meta: {}
}

// Get the singleton
hub.loadSingleton = function() {
  if (process.env.SITE_ID) {
    return hub.load(process.env.SITE_ID);
  }
  else {
    return hub.all()
      .then(function(hubs) {
        if (_.size(hubs) != 1) {
          throw HttpError[404]('Hub should be a singleton (' + _.size(hubs) + ')');
        }
        var oneHub = _.find(hubs, function(){return true});
        process.env.SITE_ID = oneHub.id;
        return oneHub;
      })
  }
}

// Expose statics to base
Base.models.hub = MODEL;
Base.classes.hub = hub;
['load','loadIndexed','loadByHref','delete','all'].forEach(function(methodName) {
  hub[methodName] = function() {return Base[methodName](MODEL.type, arguments);}
})
