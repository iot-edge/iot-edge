var config = require('config')
var HttpError = require('httperrors')
var Router = require('express-promise-router')
var Request = require('request-promise')
var Zone = require('../persist').Zone;
var devices = require('./devices');
var _ = require('lodash')
var Dashboard = require('../dashboard');

var zones = module.exports = Router()

/**
 * Sanitize the input form.
 *
 * This defaults, translates, throws exceptions on error, and returns a sanitized resource
 */
zones.sanitizeInput = function(request) {

  var body = void 0
  return Promise.resolve()
    .then(function() {
      body = request.getParams({body:['*id','*type', 'name','*dashSlug','*order','*alertEmailTo','*alertSmsTo','*links']})

      if (body.type && body.type !== 'zone') {
        throw new HttpError.BadRequest('Invalid resource type: ' + body.type)
      }
      body.type = 'zone'

      if (body.id && request.method == 'POST') {
        throw new HttpError.BadRequest('Cannot provide resource ID on POST')
      }

      // TODO: Sanitize links

      return body;
    })
}

// Implementations
zones.postZone = function(request, response) {
  var zone;
  return zones.sanitizeInput(request)
    .then(function(sanitized){
      zone = new Zone(sanitized);
      return zones.addDashboard(zone);
    })
    .then(function(dbAddRsp) {
      zone.dashSlug = dbAddRsp.slug;
      return zone.save();
    })
    .then(function() {
      response.send(zone)
    })
}

// Update a zone
zones.putZone = function(request, response) {
  var zone;
  return zones.sanitizeInput(request)
    .then(function(sanitized){
      zone = new Zone(sanitized);
      return zones.updateDashboard(zone);
    })
    .then(function(saveRsp){
      zone.dashSlug = saveRsp.slug;
      return zone.save();
    })
    .then(function(zone) {
      response.send(zone)
    })
}

// Returns all zones
// Or a list of zones by id: ?ids=id,id,id...
zones.searchZones = function(request, response) {
  var ids = request.getParams({query:['*ids']}).ids
  if (ids) {
    return zones.getMany(ids.split(','))
      .then(function(zones) {
        response.send(_.toArray(zones)); // keep requested ordering
      });
  }
  return Zone.all()
    .then(function(zones) {
      var sorted = _.sortBy(zones,'order');
      response.send(sorted);
    });
}

// Return many zones (by id) into an array
zones.getMany = function(ids) {
  return Promise.resolve()
    .then(function() {
      var promises = [];
      ids.forEach(function(zoneId) {
        promises.push(Zone.load(zoneId))
      })
      return Promise.all(promises);
    })
}

// Returns a zone by id
zones.getZone = function(request, response) {
  var zoneId = request.getParams({url:['zoneId']}).zoneId
  return Zone.load(zoneId)
    .then(function(zone) {
      response.send(zone);
    });
}

zones.deleteZones = function(request, response) {
  var zoneIds = [];
  return Promise.resolve()
    .then(function(){
      zoneIds = request.getParams({path:['zoneIds']}).zoneIds.split(',')
      return zones.getMany(zoneIds);
    })
    .then(function(zonesToDelete) {
      return zones.deleteDashboards(zonesToDelete);
    })
    .then(function(){
      var promises = [];
      zoneIds.forEach(function(zoneId){
        promises.push(Zone.delete(zoneId));
      });
      return Promise.all(promises);
    })
    .then(function() {
      response.send({status:'ok'});
    })
}

// Delete dashboards associated with the array of zones
zones.deleteDashboards = function(zonesToDelete) {
  var promises = [];
  zonesToDelete.forEach(function(zone) {
    promises.push(Dashboard.remove(zone.dashSlug))
  });
  return Promise.all(promises);
}

// Add a dashboard for the specified zone
zones.addDashboard = function(zone) {
  return Promise.resolve()
    .then(function() {
      return zones.buildDashboard(zone);
    })
    .then(function(newDB) {
      return Dashboard.save({dashboard: newDB})
    })
    .then(function(rsp) {
      if (rsp.status == 'name-exists') {
        throw new HttpError.Conflict('Dashboard exists: ' + zone.name);
      }
      if (rsp.status != 'success') {
        console.error('Cannot create dashboard ' + JSON.stringify(rsp) + ' dash:' + JSON.stringify(newDB));
        throw new HttpError.InternalServerError('Cannot create dashboard: ' + rsp.status);
      }
      // Example response: {"slug":"zone-5","status":"success","version":0}
      return rsp;
    });
}

// Update a zone dashboard
zones.updateDashboard = function(zone, setDefault) {
  var newDB;
  var response;
  return Promise.resolve()
    .then(function() {
      return zones.buildDashboard(zone);
    })
    .then(function(db) {
      newDB = db;
      return Dashboard.load(zone.dashSlug)
    })
    .catch(function(err) {
      if (!err.NotFound) {
        console.error('Problem loading dashboard for update');
        throw err;
      }
      return null;
    })
    .then(function(oldDB){
      newDB.id = oldDB ? oldDB.dashboard.id : null;
      newDB.version = oldDB ? oldDB.dashboard.version : 1;
      return Dashboard.save({dashboard: newDB})
    })
    .then(function(rsp) {
      response = rsp;
      if (rsp.status == 'name-exists') {
        throw new HttpError.Conflict('Dashboard exists: ' + zone.name);
      }
      if (rsp.status != 'success') {
        console.error('Cannot update dashboard ' + JSON.stringify(rsp) + ' dash:' + JSON.stringify(newDB));
        throw new HttpError.InternalServerError('Cannot update dashboard: ' + rsp.status);
      }

      if (setDefault) {
        return Dashboard.setDefault(response.slug)
          .then(function(){
            return response;
          })
      }

      // Example response: {"slug":"zone-5","status":"success","version":0}
      return response;
    })
}

// This places the specified device into the zone(s) defined by the device
zones.placeDeviceIntoZones = function (device) {
  var deviceLinkName = ':' + device.id;
  var isDeviceInThisZone = function(device, zone) {
    var allZones = device.links.zones ? _.clone(device.links.zones) : [];
    if (device.links.zone) {
      allZones.push(device.links.zone);
    }
    var zoneHref = 'zone/' + zone.id;
    return _.findIndex(allZones, function(zone) {return zone.href == zoneHref}) >= 0;
  }
  return Zone.all()
    .then(function(allZones) {
      var chain = Promise.resolve();
      _.each(allZones, function(zone) {
        var deviceShouldBeInThisZone = isDeviceInThisZone(device, zone);
        var deviceIsCurrentlyInThisZone = 
            _.findIndex(zone.links.devices, function(link) {return link.name == deviceLinkName}) >= 0;
        if (deviceShouldBeInThisZone && !deviceIsCurrentlyInThisZone) {
          zone.addLink('devices', deviceLinkName, device);
          chain = chain.then(function(){return zone.save()});
        }
        if (!deviceShouldBeInThisZone && deviceIsCurrentlyInThisZone) {
          zone.rmLink('devices', deviceLinkName);
          chain = chain.then(function(){return zone.save()});
        }
      })
      return chain;
    })
}

zones.rebuildZoneDashboards = function () {
  var allZones = [];
  return Promise.resolve()
    .then(function() {
      return Zone.all()
    })
    .then(function(all) {
      // Update zone dashboards
      allZones = _.orderBy(all, 'order');
      var chain = Promise.resolve();
      _.each(allZones, function(zone, index) {
        chain = chain.then(function() {
          var isFirstDashboard = index == 0;
          return zones.updateDashboard(zone, isFirstDashboard)

        });
      })
      return chain;
    })
}

zones.buildDashboard = function(zone) {
  var newDB = _.extend({}, zones.dashboard, {title:zone.name,rows:[],templating:[],links:[]});
  var nextPanelId = 1;
  return Promise.resolve()
    .then(function() {
      return zone.loadLinked('devices')
    })
    .then(function(zoneDevices) {
      // Add row1 from each device dashboard
      var chain = Promise.resolve();
      zoneDevices.forEach(function(device, index) {
        let deviceDash = null;
        chain = chain.then(function(){
          return devices.loadDashboard(device);
        })
        .then(function(dash){
          deviceDash = dash;
          // No dashboard for the device
          if (!deviceDash) {return;}
          return device.loadLinked('product');
        })
        .then(function(product){

          // No dashboard for the device
          if (!deviceDash) {return;}

          // Add the row, replacing template variables
          var row1 = deviceDash.dashboard.rows[0];
          row1 = Dashboard.replaceTemplate(row1, {product: product, device: device, zone: zone});

          // Make the row title consistent
          row1.showTitle = true;
          row1.title = device.name;
          row1.titleSize = "h5";

          // Re-assign panel IDs
          _.each(row1.panels, function(panel) {panel.id = nextPanelId++});

          // Expand the first 4 devices in a zone, collapse the rest
          row1.collapse = index >= 4;

          newDB.rows.push(row1);

        })
        .catch(function(e) {
          // Don't let one bad dashboard spoil the rest
          if (!e.NotFound) {
            console.error('Bad dashboard load for: ', device);
          }
        })
      });
      return chain;
    })
    .then(function(){
      return newDB;
    })
}

// A zone dashboard
zones.dashboard = {
  "id": null,
  "title": "Zone",
  "annotations": { "list": [] },
  "editable": true,
  "gnetId": null,
  "graphTooltip": 2,
  "hideControls": true,
  "links": [],
  "rows": [],
  "templating": { "list": [] },
  "tags": ["zone"],
  "schemaVersion": 14,
  "style": "dark",
  "time": {
    "from": "now-24h",
    "to": "now"
  },
  "timepicker": {
    "refresh_intervals": [ "5s", "10s", "30s", "1m", "5m", "15m", "30m", "1h", "2h", "1d" ],
    "time_options": [ "5m", "15m", "1h", "6h", "12h", "24h", "2d", "7d", "30d" ]
  },
  "timezone": "browser",
  "overwrite": true,
  "version": 0
};

// Routing table
zones.get('/zones', zones.searchZones)
zones.get('/zones/:zoneId', zones.getZone)
zones.put('/zones/:zoneId', zones.putZone)
zones.post('/zones', zones.postZone)
zones['delete']('/zones/:zoneIds', zones.deleteZones)

// Don't freak out if singulars are used for singular requests
zones.get('/zone/:zoneId', zones.getZone)
zones.put('/zone/:zoneId', zones.putZone)
zones['delete']('/zone/:zoneIds', zones.deleteZones)
