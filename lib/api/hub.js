var config = require('config').get('iot-edge');
var Promise = require('bluebird');
var HttpError = require('httperrors')
var Router = require('express-promise-router')
var Request = require('request-promise')
var AuthC = require('../authenticate');
var AuthZ = require('../authorize');
var Dashboard = require('../dashboard');
var Hub = require('../persist').Hub;
var Zone = require('../persist').Zone;
var User = require('../persist').User;
var Databus = require('./databus');
var fs = Promise.promisifyAll(require('fs'));
var _ = require('lodash')
var roleNameToNum = {
  'guest': 0,
  'monitor': 1,
  'controller': 2,
  'admin': 3,
  'owner': 4,
}
var roleNumToName = ['guest','monitor','controller','admin','owner'];

var hub = module.exports = Router()

// Controlled interface to the hub structure

/**
 * Sanitize the input form.
 *
 * This defaults, translates, throws exceptions on error, and returns a sanitized resource
 */
hub.sanitizeInput = function(request) {

  var body = void 0
  return Promise.resolve()
    .then(function() {

      body = request.getParams({url:['siteId'], body:[
        'id','type','*name','*health','*publicKey','*privateKey',
        '*routerPW','*grafanaPW','*netSSID','*netPW','*wifiSSID','*wifiPW','*hubIP',
        '*links','*meta'
      ]})

      //TODO: Needs validation

      return body;
    })
}

hub.gethub = function(request, response) {
  var siteId = request.getParams({url:['siteId']}).siteId;
  return Hub.load(siteId)
    .then(function(hub) {
      // Strip private info
      delete hub.grafanaPW;
      response.send(hub);
    });
}

// Send a hub update
hub.puthub = function(request, response) {
  var siteId = request.getParams({url:['siteId']}).siteId;
  var oldHub;
  return Hub.load(siteId)
    .then(function(site) {
      oldHub = site;
      return hub.sanitizeInput(request)
    })
    .then(function(sanitized){
      _.extend(oldHub, sanitized);
      delete oldHub.siteId; // from input
      return oldHub.save()
    })
    .then(function(newHub) {
      if (newHub.name != process.env.SITE_NAME) {
        //TODO: Publish a message onto the bus
        //return hub.changeHubName(newHub.name, request);
      }
    })
    .then(function() {
      response.send({status:'ok'});
    })
}

// Persist hub info to be shared across docker containers
// opts: zero or many of
//   siteId
//   hubName
//   timezone
hub.saveSharedHubInfo = function (opts) {
  let siteId = opts.siteId || process.env.SITE_ID;
  let hubName = opts.hubName || process.env.SITE_NAME;
  let timezone = opts.timezone || process.env.TZ;
  process.env.SITE_ID = siteId;
  process.env.SITE_NAME = hubName;
  process.env.TZ = timezone;

  // This is a docker env file - don't quote the values
  return fs.writeFileAsync('/mnt/hub-env', 
`SITE_ID=${siteId}
SITE_NAME="${hubName}"
TZ=${timezone}
`);
}

// Get the hub IP address
hub.getHubIP = function() {
  return Databus.getNextMessage('devices/mc-site/network/ip-address',{timeout:5});
}

// The site, from the user's perspective
// Comes from the tunnel via API /api/v2/sites/:siteId
hub.getSite = function(request, response) {
  var user = request.user;
  var roleName = user.roles;
  var roleNum = roleNameToNum[roleName];
  var userSite = {
    id: process.env.SITE_ID,
    name: process.env.SITE_NAME,
    role: roleNum,
    menu: [],
  }

  // Build a custom menu
  if (user.links && user.links.menu && user.links.menu.href) {
    return user.loadLinked('menu')
      .then((userMenu)=>{
        userSite.menu = userMenu.items;

        // Add settings menu if an admin
        if (roleName == 'admin' || roleName == 'owner') {
          userSite.menu.push({
            id: userSite.id + '-settings',
            name: 'Site Settings',
            icon: 'settings',
            siteId: userSite.id,
            dashId: 'settings',
          })
        }

        return response.send(userSite);
      })
  }

  // Add the standard menu
  // 1 - Custom dashboards (if tagged role-{roleName})
  // 2 - All Zones
  // 3 - Settings if admin
  return Request.get(Dashboard.makeURI('/api/search?starred=false&tag=role-' + roleName))
    .then(function(dashboards) {
      // Custom dashboards
      if (Array.isArray(dashboards)) {
        dashboards.forEach(function(dash) {
          var uriParts = dash.uri.split('/');
          if (uriParts[0] != 'db') {return;}
          var slug = uriParts[1];
          userSite.menu.push({
            id: userSite.id + '-db-' + slug,
            name: dash.title,
            icon: 'speedometer',
            siteId: userSite.id,
            dashId: slug,
          })
        })
      }
      return Zone.all()
    })
    .then(function(zones) {
      // All zones
      _.forEach(_.sortBy(zones, ['order','name']), function(loc) {
        userSite.menu.push({
          id: loc.id,
          name: loc.name,
          icon: 'pin',
          siteId: userSite.id,
          dashId: loc.dashSlug,
        })
      })

      // Settings menu
      if (roleName == 'admin' || roleName == 'owner') {
        userSite.menu.push({
          id: userSite.id + '-settings',
          name: 'Site Settings',
          icon: 'settings',
          siteId: userSite.id,
          dashId: 'settings',
        })
      }

      response.send(userSite);
    })
}

// This is a personal request by a user
hub.leaveSite = function(request, response) {
  return User.delete(request.user.id)
    .then(function() {
      response.send();
    })
}

// Routing table
hub.get('/sites/:siteId', AuthC.api, hub.getSite)
hub['delete']('/sites/:siteId', AuthC.api, hub.leaveSite)

hub.get('/hub/:siteId', AuthC.session, AuthZ.role('admin'), hub.gethub)
hub.put('/hub/:siteId', AuthC.session, AuthZ.role('admin'), hub.puthub)

