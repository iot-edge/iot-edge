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

  grafanaAPIKey: "", // Grafana API Key for the hub
  wifiSSID: "",      // SSID - defaults to mc-hub-${hubId}
  wifiPW: "",        // Hub wifi password
  hubIP: "",         // Hub IP Address

  links: {
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
