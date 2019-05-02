var Promise = require('bluebird');
var HttpError = require('httperrors')
var Router = require('express-promise-router')
var Request = require('request-promise')
var Device = require('../persist').Device;
var Zone = require('../persist').Zone;
var Hub = require('../persist').Hub;
var Product = require('../persist').Product;
var products = require('./products');
var nodered = require('../node-red');
var zones = null;
var Dashboard = require('../dashboard');
var FLOW_LIB = '/mnt/node-red/lib/flows';
var uuid = require('uuid');
var _ = require('lodash')
var AuthC = require('../authenticate');
var AuthZ = require('../authorize');

// Defer for circular reference
setTimeout(function() {
    zones = require('./zones');
},1);

var devices = module.exports = Router()

/**
 * Sanitize the input form.
 *
 * This defaults, translates, throws exceptions on error, and returns a sanitized resource
 */
devices.sanitizeInput = function(request) {

  var body = void 0
  return Promise.resolve()
    .then(function() {
      body = request.getParams({body:[
          '*id','*type','*name','*metricKey','serialNumber',
          'activated','*dashSlug','options','config','calibrations','*limits','*links','meta'
      ]})

      if (body.type && body.type !== 'device') {
        throw new HttpError.BadRequest('Invalid resource type: ' + body.type)
      }
      body.type = 'device'

      // TODO: Sanitize links
      return body;
    })
}

// Update the device software (over the air)
devices.ota = function(request, response) {
  var deviceId = request.getParams({path:['deviceId']}).deviceId;
  var force = !!request.getParams({query:['*force']}).force;
  return devices.updateOTA(deviceId, {force:force})
    .then((status)=>{
      return response.send({status:status});
    })
    .catch((err)=>{
      if (err.statusCode == 502) {
        return response.status(502).send({status:err.message});
      }
      throw err;
    })
}

// Update the device software (over the air)
// deviceId: Device to send update to
// params: {
//   force(boolean): Force an update, even if not necessary?
// }
devices.updateOTA = async function(deviceId, params) {
  var device;
  var product;
  return Device.load(deviceId)
    .then((loaded)=>{
      device = loaded;
      return device.loadLinked('product');
    })
    .then((loaded)=>{
      product = loaded;
      if (!product.installer) {
        throw new HttpError.BadRequest('Product has no OTA installer');
      }
      var installer = require('../installers/' + product.installer);
      if (!installer.ota) {
        throw new HttpError.BadRequest('Product intaller has no OTA capability');
      }
      return installer.ota(device, product, params);
    })
}

// Add or update a device
devices.putDevice = function(request, response) {
  var newDevice;
  var oldDevice;
  var product;
  return devices.sanitizeInput(request)
    .then(function(sanitized){
      if (sanitized.id == 'new') {
        sanitized.id = uuid.v4();
      }
      newDevice = new Device(sanitized);
      return Device.load(newDevice.id);
    })
    .catch(function(err) {
      if (err.statusCode == 404) { return new Device({id:newDevice.id}); }
      throw err;
    })
    .then(function(prior) {
      oldDevice = prior;
      return newDevice.loadLinked('product')
    })
    .then(function(linked) {
      product = linked;

      // Perform actions
      if (newDevice.activated == '') {
        return devices.deactivate(product, newDevice);
      }
      else if (newDevice.activated != oldDevice.activated) {
        return devices.activate(product, newDevice);
      }

    })
    .then(function() {
      // Register the device with the product
      if (!product.devices || !product.devices[newDevice.metricKey]) {
        product.addLink('devices', newDevice.metricKey, newDevice);
        return product.save();
      }
    })
    .then(function() {
      return devices.update(product, oldDevice, newDevice);
    })
    .then(function() {
      return newDevice.save();
    })
    .then(function() {
      response.send(newDevice)
    })
}

devices.activate = function(product, device) {
  return Promise.resolve()
    .then(function() {
      // Attach the device to the network (LAN and MQTT)
      var installer = require('../installers/' + product.installer);
      return installer.attach(product, device);
    })
    .then(function() {
      // Add device to zone (if it has a zone)
      if (device.links.zone && device.links.zone.href) {
        return device.loadLinked('zone')
      }
    })
    .then(function(zone) {
      if (zone) {
        zone.addLink('devices', ':' + device.id, device);
        return zone.save();
      }
    })
    .then(function() {
      device.activated = new Date().toISOString();
      return device;
    })
}

devices.deactivate = function(product, device) {
  return Promise.resolve()
    .then(function() {
      // Detatch the device from the network
      var installer = require('../installers/' + product.installer);
      return installer.detach(product, device);
    })
    .then(function() {
      // Remove the device from all zones
      return Zone.all();
    })
    .then(function(allZones) {
      var chain = Promise.resolve();
      var deviceName = ':' + device.id;
      _.each(allZones, function(zone) {
        if (zone.links.devices[deviceName]) {
          chain = chain.then(function() {
            zone.rmLink('devices', deviceName);
            return zone.save();
          })
          .then(function(){return zones.updateDashboard(zone)})
        }
      })
      return chain;
    })
    .then(function(){
      // Remove device dashboard
      if (product.deviceDashSlug) {
        return Dashboard.remove(device.dashSlug);
      }
    })
    .catch(function(err){
      console.error('Problem removing dashboard ' + device.dashSlug + '. Continuing.', err);
    })
    .then(function(){
      // Remove device flow
      var flowId = device.metricKey;
      return nodered.deleteFlow(flowId)
    })
    .then(function() {
      device.activated = null;
      return device;
    })
}

// Update all software artifacts for a device.
devices.update = function(product, oldDevice, newDevice) {
  var deviceName = ':' + newDevice.id
  return Promise.resolve()
    .then(function() {
      // Build the device dashboard
      if (product.deviceDashSlug) {
        return devices.writeDashboard(product, newDevice, oldDevice.dashSlug)
          .then(function() {
            return newDevice.save();
          })
      }
    })
    .then(function() {
      if (!oldDevice || oldDevice.links.zone.href !== newDevice.links.zone.href) {
        return zones.placeDeviceIntoZones(newDevice);
      }
    })
    .then(function() {
      return zones.rebuildZoneDashboards()
    })
    .then(function() {
      // Update node-red flow
      return devices.updateFlow(product, newDevice);
    })
}

// Write a dashboard for the device
devices.writeDashboard = function(product, device, oldDeviceSlug, dupNameTryNum) {
  if (!oldDeviceSlug) {
    oldDeviceSlug = device.dashSlug;
  }
  var oldDB;
  var newDB;
  // Remove the old dashboard, then create/write the new one
  return Dashboard.load(oldDeviceSlug)
    .then(function(db) {
      oldDB = db.dashboard;
    })
    .catch(function(err) {})
    .then(function() {
      // Load product dashboard (template)
      return Dashboard.load(product.deviceDashSlug)
    })
    .then(function(productDb) {
      newDB = productDb.dashboard;

      // Alter the product dashboard for a device dashboard
      delete newDB.uid;
      newDB.rows.splice(0,1);
      newDB.id = oldDB ? oldDB.id : null;
      newDB.version = oldDB ? oldDB.version : 1;
      newDB.title = device.name;
      if (dupNameTryNum) {
        newDB.title = newDB.title + ' (' + dupNameTryNum + ')';
      }

      // Tag properly
      newDB.tags.push('device');
      newDB.tags.push(product.id);
      newDB.tags.push(device.metricKey);

      newDB = Dashboard.replaceTemplate(newDB, {product: product, device: device});

      // Replace alert names with a data structure containing alert metadata
      if (device.limits) {
        _.each(newDB.rows, function(row) {
          _.each(row.panels, function(panel) {
            if (panel.alert) {
              var alertName = panel.alert.name;
              if (alertName.indexOf('device.limits.') == 0) {
                var limitName = alertName.split('.')[2];
                var limitDef = device.limits[limitName];
                if (limitDef) {
                  panel.alert.name = JSON.stringify({
                    name: device.name + ' > ' + limitDef.name,
                    deviceId: device.id,
                    tags: limitDef.tags
                  })
                }
              }
            }
          })
        })
      }

      return Dashboard.save({dashboard:newDB});
    })
    .then(function(rsp) {
      if (rsp.status == 'name-exists') {
        dupNameTryNum = dupNameTryNum ? dupNameTryNum + 1 : 1;
        if (dupNameTryNum > 20) {
          throw new HttpError.Conflict('Too many duplicate device names: ' + device.name);
        }
        return devices.writeDashboard(product, device, oldDeviceSlug, dupNameTryNum);
      }
      if (rsp.status != 'success') {
        console.error('Cannot update dashboard ' + JSON.stringify(rsp) + ' dash:' + JSON.stringify(newDB));
        throw new HttpError.InternalServerError('Cannot update dashboard: ' + rsp.status);
      }
      // Example response: {"slug":"dash-slug-5","status":"success","version":0}
      device.dashSlug = rsp.slug;
      device.name = newDB.title;
      return rsp;
    });
}

devices.updateFlow = function(product, device) {
  return Hub.load(process.env.SITE_ID)
    .then(function(hub){

      var flowId = device.metricKey;
      var flowName = device.metricKey;
      var flowTitle = device.name;
      var templateFilename = FLOW_LIB + '/' + product.id + '/device.json';
      var dataModel = {
        TZ: process.env.TZ,
        MQTT_BROKER_ID: nodered.MQTT_BROKER.id,
        hub: {id: hub.id, name: hub.name},
        product: product,
        device: device
      };
      return nodered.mergeTemplate(flowId, flowName, flowTitle, templateFilename, dataModel);
    })
}

// Load the main dashboard w/meta for the device, as specified by product.deviceDashSlug
// If the product doesn't have a main device dashboard, return null (not an error)
devices.loadDashboard = function(device) {
  return Promise.resolve()
    .then(function(){
      return device.loadLinked('product')
    })
    .then(function(product) {
      return products.loadDeviceDash(product);
    })
}

// Returns all devices
// Or a list of devices by id: ?ids=id,id,id...
// Or a list of devices by product: ?productId=mc-cam
// Or a wifi scan of available devices
// Or a product scan of a specific module by name
devices.searchDevices = function(request, response) {
  var query = request.getParams({query:['*ids','*scan','*module', '*productId']});
  var ids = query.ids;
  var scan = query.scan;
  var module = query.module;
  var productId = query.productId;
  var promise;
  if (module !== undefined) {
    promise = devices.scanByModule(module);
  }
  else if (scan !== undefined) {
    promise = devices.scan();
  }
  else if (ids) {
    promise = devices.getMany(ids.split(','));
  }
  else if (productId) {
    promise = devices.getByProduct(productId);
  }
  else {
    promise = Device.all();
  }
  return promise
    .then(function(devices) {
      response.send(_.toArray(devices));
    });
}

// Scan for devices available within wifi range
// This adds the device, but doesn't install it.
devices.scan = function() {
  var scanPromises = [];
  return Promise.resolve()
    .then(function() {
      // Add all known scanners
      // scanPromises.push(homie.scan());
      // scanPromises.push(foscam.scan());
      return Promise.all(scanPromises);
    })
    .then(function(foundDevicesByType) {
      return _.flatten(foundDevicesByType);
    })
}

// Scan for a product code by module
devices.scanByModule = function(moduleId) {
  return Promise.resolve()
    .then(function() {
      return products.loadFromNPM(moduleId);
    })
    .then(function(product) {
      var installer = require('../installers/' + product.installer);
      return installer.scan(product);
    })
}

// Return all devices for a specified product
devices.getByProduct = function(productId) {
  return Promise.resolve()
    .then(function() {
      return Product.load(productId)
    })
    .then(function(product) {
      return product.loadLinked('devices');
    })
}

// Return many devices (by id) into an array
devices.getMany = function(ids) {
  return Promise.resolve()
    .then(function() {
      var promises = [];
      ids.forEach(function(deviceId) {
        promises.push(Device.load(deviceId))
      })
      return Promise.all(promises);
    })
}

// Returns a device by id
devices.getDevice = function(request, response) {
  var deviceId = request.getParams({url:['deviceId']}).deviceId
  return Device.load(deviceId)
    .then(function(device) {
      response.send(device);
    });
}

devices.deleteDevices = function(request, response) {
  var deviceIds = [];
  return Promise.resolve()
    .then(function(){
      var promises = [];
      deviceIds = request.getParams({path:['deviceIds']}).deviceIds.split(',')
      deviceIds.forEach(function(deviceId){
        promises.push(devices.deleteDevice(deviceId, true));
      });
      return Promise.all(promises);
    })
    .then(function() {
      response.send({status:'ok'});
    })
}

devices.deleteDevice = function(deviceId) {
  var device = null;
  var product = null;
  return Device.load(deviceId)
    .then(function(dev) {
      device = dev;
      return device.loadLinked('product');
    })
    .then(function(prod){
      // Deactivate device (removes from the network, zones, flows, rebuilds zone dashboards)
      product = prod;
      if (product.id == 'mc-controller') {
        throw new HttpError.BadRequest('Cannot remove the controller device');
      }
      return devices.deactivate(product, device);
    })
    .then(function(){
      product.rmLink('devices', device.metricKey);
      return product.save();
    })
    .then(function(){
      return device.delete();
    })
}

// Routing table
devices.get('/devices', devices.searchDevices)
devices.get('/devices/:deviceId', devices.getDevice)
devices.put('/devices/:deviceId', AuthC.session, AuthZ.role('admin'), devices.putDevice)
devices.post('/devices/:deviceId/ota', AuthC.session, AuthZ.role('admin'), devices.ota)
devices['delete']('/devices/:deviceIds', AuthC.session, AuthZ.role('admin'), devices.deleteDevices)
