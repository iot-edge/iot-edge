var Promise = require('bluebird');
var HttpError = require('httperrors')
var Router = require('express-promise-router')
var Request = require('request-promise')
var Plugin = require('../persist').Plugin;
var Device = require('../persist').Device;
var Hub = require('../persist').Hub;
var Dashboard = require('../dashboard');
var nodered = require('../node-red');
var cp = Promise.promisifyAll(require('child_process'));
var fs = Promise.promisifyAll(require('fs'));
var config = require('config').get('iot-edge');
var nodeRedUrl = 'http://' + config.get('nodered.host') + ':' + config.get('nodered.port') + config.get('nodered.path');
var _ = require('lodash')
var REGISTRY = "https://registry.npmjs.org";
var FLOW_LIB = '/mnt/node-red/lib/flows';
var AuthC = require('../authenticate');
var AuthZ = require('../authorize');
var plugins = module.exports = Router()

/**
 * Sanitize the input form.
 *
 * This defaults, translates, throws exceptions on error, and returns a sanitized resource
 */
plugins.sanitizeInput = async function(request) {

  let body = request.getParams({path:['*pluginId'], body:['*id','*type','*links','*meta']})

  if (body.type && body.type !== 'plugin') {
    throw new HttpError.BadRequest('Invalid resource type: ' + body.type)
  }
  body.type = 'plugin'

  if (body.pluginId && body.id && (body.pluginId != body.id)) {
    throw new HttpError.BadRequest('Cannot change plugin ID')
  }
  if (body.pluginId) {
    body.id = body.pluginId;
    delete body.pluginId;
  }

  // TODO: Sanitize links
  return body;
}

// Install a new plugin
plugins.postPlugin = async function(request, response) {
  let sanitized = await sanitizeInput(request);
  let pluginId = sanitized.id;
  try {
    let existing = Plugin.load(pluginId);
    throw new HttpError.Conflict('Plugin already exists with ID: ' + existing.id + ' - Name: ' + existing.name);
  }
  catch(err) {
    // 404 is expected
    if (err.name == 'Conflict') { throw err; }
  }
  let newPlugin = await loadFromNPM(pluginId);
  newPlugin = await plugins.install(newPlugin, 'latest');
  response.send(newPlugin);
}

// Insert or update a Plugin
plugins.putPlugin = async function(request, response) {
  let sanitized = plugins.sanitizeInput(request);
  let plugin = new Plugin(sanitized);
  let prior;
  try {
    prior = Plugin.load(plugin.id);
  }
  catch(err) {
    if (err.statusCode != 404) {
      throw err;
    }
    prior = {};
  }

  plugin = await plugins.loadPluginDefinition(prior.id ? prior : plugin);

  // Are we requesting a version change?
  if (prior.version !== plugin.version) {
    await plugins.install(plugin, plugin.version);
  }
  plugin.save();
  response.send(plugin);
}

// Check for and install plugin updates
plugins.updatePlugin = async function(request, response) {
  var pluginId = request.params.pluginId;
  let plugin = await plugins.updatePluginById(pluginId)
  response.send(plugin)
}

plugins.updatePlugins = async function(request, response) {
  await plugins.updateAllPlugins();
  response.send({status:"ok"});
}

plugins.updateAllPlugins = async function() {
  let allPlugins = await Plugins.all();
  for (let pluginNum in allPlugins) {
    let plugin = allPlugins[pluginNum];
    await plugins.updatePluginById(plugin.id);
  }
}

plugins.updatePluginById = async function(pluginId) {
  let plugin = await Plugin.load(pluginId);
  await plugins.install(plugin, 'latest');
}

// Install or update
plugins.install = async function(product, tag) {
  var force = (tag[0] == '!');
  if (force) {
    tag = tag.substr(1);
  }

  var newVersion;
  return Promise.resolve()
    .then(function(){
      // Convert possible version tag to version #
      return cp.execAsync('npm --registry ' + REGISTRY + ' info ' + product.id + '@' + tag + ' version')
    })
    .then(function(version){
      newVersion = version.trim();

      // Return a numeric representation of the version
      var versionNum = function(versionStr) {
        if (!versionStr) return 0;
        var parts = versionStr.split('.');
        return +parts[0] * 1000000 + +parts[1] * 1000 + +parts[2];
      }

      // Exit early if this is the newest product version
      if (!force && (versionNum(product.version) >= versionNum(newVersion))) {
        throw new HttpError.NotFound('Newer version not found');
      }

      // Update product definition
      return plugins.loadFromNPM(product.id);
    })

    .then(function(npmProduct){
      console.log('Installing ' + tag + ' (' + newVersion + ') for ' + product.id);

      // Overwrite local definition with NPM changes
      product.name = npmProduct.name;
      product.version = newVersion;
      product.manufacturer = npmProduct.manufacturer;
      product.url = npmProduct.url;
      product.newDeviceName = npmProduct.newDeviceName;
      product.deviceDashSlug = npmProduct.deviceDashSlug;
      product.installer = npmProduct.installer;
      product.connectPanelId = npmProduct.connectPanelId;
      product.defaultConfig = npmProduct.defaultConfig;
      product.defaultLimits = npmProduct.defaultLimits;

      // Update device default configurations
      return plugins.updateDeviceConfigs(product);
    })
    .then(function() {
      // Install in the grafana plugins directory
      var cmd = 'cd /mnt/grafana/plugins; curl -v ' + REGISTRY
        + '/' + product.id + '/-/' + product.id + '-' + product.version + '.tgz | tar xzf -; '
        + 'rm -rf ' + product.id + '; mv package ' + product.id;
      console.log('Expanding grafana plugins: ' + cmd);
      return cp.execAsync(cmd)
    })
    .then(function(){
      console.log('Installing grafana plugins');
      return plugins.installGrafanaPlugin(product);
    })
    .catch(function(err) {
      if (!err.NotFound) {
        console.error('Error installing grafana plugin:', err);
      }
      throw err;
    })
    .then(function(){
      console.log('Installing node-red plugins');
      return plugins.installNodeRedPlugin(product);
    })
    .catch(function(err) {
      if (!err.NotFound) {
        console.error('Error installing node red plugin:', err);
      }
      throw err;
    })
    .then(function(){
      console.log('Rebuilding zone dashboards');
      var zones = require('./zones');
      return zones.rebuildZoneDashboards(product);
    })
    .catch(function(err) {
      if (!err.NotFound) {
        console.error('Error building zone dashboards', err);
      }
      throw err;
    })
    .then(function(){
      console.log('Rebuilding device dashboards');
      return plugins.rebuildDeviceDashboards(product);
    })
    .catch(function(err) {
      if (!err.NotFound) {
        console.error('Error building device dashboards', err);
      }
      throw err;
    })
    .then(function(){
      console.log('Completed install for ' + product.id);
      return product.save();
    })
    .catch(function(err) {
      // New version not found. Status=ok.
      if (err.NotFound) {return product}
      console.log('Install error for ' + product.id + ': ' + err.message);
      throw err;
    })
}

plugins.updateDeviceConfigs = async function (product) {
  return product.loadLinked('devices')
    .then(function(devices) {
      var chain = Promise.resolve();
      _.each(devices, function(device) {
        chain = chain.then(function(){return plugins.updateDeviceConfig(product, device)});
      })
      return chain;
    })
}

plugins.updateDeviceConfig = async function (product, device) {
  device.config = device.config || {};
  device.limits = device.limits || {};
  _.defaultsDeep(device.config, product.defaultConfig);
  _.defaultsDeep(device.limits, product.defaultLimits);
  return device.save();
}

plugins.rebuildDeviceDashboards = async function (product) {
  var devices = require('./devices');
  var productHref = 'product/' + product.id;
  if (!product.deviceDashSlug) {
    return Promise.resolve();
  }
  return Promise.resolve()
    .then(function() {
      return Device.all()
    })  
    .then(function(all) {
      var productDevices = _.filter(all, function(device) {
        return device.links.product.href == productHref;
      }); 
      var chain = Promise.resolve();
      _.each(productDevices, function(device) {
        if (device.activated) {
          chain = chain.then(function() {
            console.log('Writing device dashboard for: ' + device.name);
            return devices.writeDashboard(product, device)
              // This can fail because we're writing too many dashboards at once
              .catch(function(e){
                if (e.message == 'Failed to save alerts') {
                  console.log('Failed. Re-try #1');
                  return devices.writeDashboard(product, device)
                }   
              })  
              .catch(function(e){
                if (e.message == 'Failed to save alerts') {
                  console.log('Failed. Re-try #2');
                  return devices.writeDashboard(product, device)
                }   
              })  
              .catch(function(e){
                if (e.message == 'Failed to save alerts') {
                  console.log('Failed. Re-try #3');
                  return devices.writeDashboard(product, device)
                }   
              })  
              .catch(function(e){
                if (e.message == 'Failed to save alerts') {
                  console.log('Failed. Re-try #4');
                  return devices.writeDashboard(product, device)
                }   
              })  
              .catch(function(e){
                if (e.message == 'Failed to save alerts') {
                  console.log('Failed. Re-try #5');
                  return devices.writeDashboard(product, device)
                }   
              })  
              .then(function(){
                return new Promise(function(resolve, reject) {
                  setTimeout(function() {
                    return resolve();
                  }, 1000);
                }); 
              })  
          }); 
        }   
      })  
      return chain;
    })  
}

plugins.installGrafanaPlugin = async function(product) {
  /*
  //TODO: Figure out how to reboot grafana post-plugin install
  return OS.getDockerHostDriver()
    .then(function(driver) {
      // Restart grafana to recognize the newly placed app
      return driver.hostCmd("cd /mnt; docker-compose restart grafana; sleep 3");
    })
  */
  return promise.resolve()
    .then(function(){
      // Import all dashboards
      return Request.get(Dashboard.makeURI('/api/plugins/' + product.id + '/dashboards'));
    })
    .then(function(dashboards){
      var chain = Promise.resolve();
      product.deviceDashSlug = null;
      dashboards = JSON.parse(dashboards);
      dashboards.forEach(function(dash){
        if (dash.pluginId == product.id && dash.path) {
          chain = chain.then(function(){
            return plugins.importDashboard(product, dash.path)
          })
        }
      })
      return chain;
    })
    .catch(function(err) {
      console.error('Error installing grafana plugin:', err);
      throw err;
    })
}

plugins.removeGrafanaPlugin = async function(product) {
  return Promise.resolve()
    .then(function(){
      // Remove from the grafana install directory
      var cmd = 'rm -rf /mnt/grafana/plugins; rm -rf ' + product.id;
      return cp.execAsync(cmd)
    })
    /*
    //TODO: Figure out how to restart grafana
    .then(function(){
      // Restart grafana
      return OS.getDockerHostDriver()
    })
    .then(function(driver) {
      return driver.hostCmd("cd /mnt; docker-compose restart grafana; sleep 3");
    })
    */
}

plugins.importDashboard = async function(product, dashPath) {
  var isDeviceDash = (dashPath.split('/').slice(-1)[0] == 'device.json');
  var params = {
    url: Dashboard.makeURI('/api/dashboards/import'),
    method: 'POST',
    headers: {
      'content-type': 'application/json;charset=UTF-8'
    },
    body: JSON.stringify({
      pluginId: product.id,
      path: dashPath,
      overwrite: true,
      inputs:[]
    })
  }
  return Promise.resolve()
    .then(function() {
      return Request(params)
    })
    .catch(function(err) {
      console.error('Error importing dashboard for: ' + product.id + '/' + dashPath, err);
      throw err;
    })
    .then(function(dash) {
      // Returns: {"pluginId":"mc-controller","title":"Updates","imported":true,"importedUri":"db/updates","slug":"","importedRevision":1,"revision":1,"description":"","path":"dashboards/updates.json","removed":false}
      if (isDeviceDash) {
        product.deviceDashSlug = JSON.parse(dash).importedUri.split('/')[1];
      }
    })
}

plugins.installNodeRedPlugin = async function(product) {
  var srcDir = '/mnt/grafana/plugins/' + product.id + '/node-red';
  var pkgJson = srcDir + '/package.json';
  var tmpDir = '/mnt/node-red/tmp/' + product.id;
  var flowLib = '/mnt/node-red/lib/flows/' + product.id;
  return Promise.resolve()
    .then(function(){
      return fs.statAsync(srcDir);
    })
    .catch(function(err) {
      if (err.code == 'ENOENT') {throw new HttpError.NotFound('No node-red plugin')}
      throw err;
    })
    .then(function(){
      // Copy the node-red module to a place visible to the node-red container
      var cmd = 'rm -rf ' + tmpDir + '; mkdir -p ' + tmpDir + '; cp -R ' + srcDir + '/* ' + tmpDir;
      return cp.execAsync(cmd)
    })
    .then(function(){
      // Install node-red plugins if a package.json file exists
      return fs.statAsync(pkgJson)
        .then(function(){
          var cmd = 'cd /mnt/node-red; npm install ' + tmpDir
          return cp.execAsync(cmd)
        })
        /*
        //TODO: Figure out how to restart node-red
        .then(function(){
          return OS.getDockerHostDriver()
        })
        .then(function(driver) {
          console.log('Restarting node-red');
          return driver.hostCmd("cd /mnt; docker-compose restart nodered; sleep 30");
        })
        */
        .catch(function() {})
    })
    .then(function(){
      // Import flows library
      var cmd = 'rm -rf ' + flowLib + '; mkdir -p ' + flowLib + '; cp ' + srcDir + '/flows/* ' + flowLib + '; true';
      return cp.execAsync(cmd)
    })
    .then(function() {
      return plugins.updateAllFlows(product);
    })
    .catch(function(err) {
      if (err.code == 'NOENT' || err.statusCode == 404) {
        return;
      }
      console.error('Error installing node-red components for ' + product.id, err);
      throw err;
    })
}

plugins.removeNodeRedPlugin = async function(product) {
  var flowLib = '/mnt/node-red/lib/flows/' + product.id;
  return Promise.resolve()
    .then(function() {
      var params = {
        url: nodeRedUrl + '/nodes/' + product.id,
        method: 'DELETE'
      }
      return Request(params);
    })
    .catch(function(err) {
      if (err.statusCode == 404) { return; }
      throw err;
    })
    .then(function(){
      var cmd = 'rm -rf ' + flowLib;
      return cp.execAsync(cmd)
    })
    .then(function(){
      var flowId = product.id;
      return nodered.deleteFlow(flowId);
    })
    .catch(function(err) {
      if (err.code == 'NOENT' || err.statusCode == 404) {
        return;
      }
      console.error('Error removing node-red components for ' + product.id, err);
      throw err;
    })
}

plugins.updateAllFlows = async function(product) {
  return Hub.load(process.env.SITE_ID)
    .then(function(hub){
      // Update the product flow
      var flowId = product.id;
      var flowName = product.id;
      var flowTitle = product.name;
      var templateFilename = FLOW_LIB + '/' + product.id + '/product.json';
      var dataModel = {
        TZ: process.env.TZ,
        MQTT_BROKER_ID: nodered.MQTT_BROKER.id,
        hub: {id: hub.id, name: hub.name},
        product: product
      };
      return nodered.mergeTemplate(flowId, flowName, flowTitle, templateFilename, dataModel);
    })
    .then(function(){
      return plugins.updateDeviceFlows(product);
    })
}

plugins.updateDeviceFlows = async function(product) {
  var productHref = product.getHref();
  return Device.all()
    .then(function(allDevices) {
      var devices = _.filter(allDevices, function(device) {
        return device.product && (device.product.href == productHref);
      });
      var chain = Promise.resolve();
      devices.forEach(function(device) {
        chain = chain.then(function(){
          return devices.updateFlow(product, device);
        });
      })
      return chain;
    })
}

plugins.searchPlugins = async function(request, response) {
}

// Return many plugins (by id) into an array
plugins.getMany = async function(ids) {
  return Promise.resolve()
    .then(function() {
      var promises = [];
      ids.forEach(function(pluginId) {
        promises.push(Product.load(pluginId))
      })
      return Promise.all(promises);
    })
}

// Returns a product by id. Installs if ?install
plugins.getPlugin = async function(request, response) {
  var pluginId = request.getParams({url:['pluginId']}).pluginId
  return Product.load(pluginId)
    .then(function(product) {
      response.send(product);
    });
}

// Load a product from NPM
plugins.loadFromNPM = async function(moduleId) {
  var oldProduct = null;
  return Promise.resolve()
    .then(function() {
      return Product.load(moduleId);
    })
    .catch(function(err) {
      if (!HttpError.NotFound) {throw err}
    })
    .then(function(prod) {
      if (prod) {
        oldProduct = prod;
      }
      return cp.execAsync('npm --json --registry ' + REGISTRY + ' info ' + moduleId);
    })
    .catch(function(err) {
      throw new HttpError.NotFound('Cannot load module from NPM: ' + moduleId);
    })
    .then(function(out) {
      var info = JSON.parse(out);
      var version = info['dist-tags'] && info['dist-tags'].latest;
      var PP_URL = "https://www.microclimates.com/device-privacy-policy";
      var SA_URL = "https://www.microclimates.com/device-security-agreement";
      var validAfter = new Date('01/01/2017');

      // Verify the microclimates licence
      var mcInfo = info['microclimates-device'];
      if (!mcInfo) throw new HttpError.Unauthorized('No Microclimates section in package.json');
      if (!mcInfo.manufacturer) throw new HttpError.Unauthorized('Missing manufacturer in package.json');
      if (!mcInfo.url) throw new HttpError.Unauthorized('Missing url in package.json');
      if (!mcInfo.newDeviceName) throw new HttpError.Unauthorized('Missing newDeviceName in package.json');
      if (!mcInfo.installer) throw new HttpError.Unauthorized('Missing installer type in package.json');
      var pp = mcInfo['privacy-policy'];
      var sa = mcInfo['security-agreement'];
      if (!pp) throw new HttpError.Unauthorized('Missing privacy-policy in package.json');
      if (!sa) throw new HttpError.Unauthorized('Missing security-agreement in package.json');
      if (pp.url != PP_URL) throw new HttpError.Unauthorized('Incorrect privacy policy URL');
      if (sa.url != SA_URL) throw new HttpError.Unauthorized('Incorrect security agreement URL');
      var ppAcceptDate = new Date(pp.accepted);
      var saAcceptDate = new Date(sa.accepted);
      if (ppAcceptDate < validAfter) throw new HttpError.Unauthorized('Invalid privacy policy acceptance date');
      if (saAcceptDate < validAfter) throw new HttpError.Unauthorized('Invalid security agreement acceptance date');
      if (mcInfo.installer.indexOf('/') >= 0) throw new HttpError.Unauthorized('Installer security violation');
      try {
        var installer = require('../installers/' + mcInfo.installer);
      }
      catch (e) {
        throw new HttpError.Unauthorized('Unknown installer type in package.json: ' + mcInfo.installer);
      }

      // Build the product data structure
      var product = oldProduct || new Product({id: moduleId});
      product.name = info.description;
      product.manufacturer = mcInfo.manufacturer;
      product.url = mcInfo.url;
      product.newDeviceName = mcInfo.newDeviceName;
      product.installer = mcInfo.installer || 'homie';
      product.connectPanelId = mcInfo.connectPanelId || '';

      product.defaultConfig = product.defaultConfig || {};
      product.defaultLimits = product.defaultLimits || {};
      _.defaultsDeep(product.defaultConfig, mcInfo.defaultConfig || {});
      _.defaultsDeep(product.defaultLimits, mcInfo.defaultLimits || {});

      // This doesn't install the product, so keep the prior version or null
      product.version = oldProduct ? oldProduct.version : null;

      return product.save();
    })
}


// Load the main device dashboard w/meta if available.
plugins.loadDeviceDash = async function(product) {
  return Promise.resolve()
    .then(function() {
      if (product.deviceDashSlug) {
        return Dashboard.load(product.deviceDashSlug);
      }
      return null;
    })
}

plugins.deletePlugins = async function(request, response) {
  var pluginIds = [];
  return Promise.resolve()
    .then(function(){
      var promises = [];
      pluginIds = request.getParams({path:['pluginIds']}).pluginIds.split(',')
      pluginIds.forEach(function(pluginId){
        promises.push(plugins.deleteProduct(pluginId));
      });
      return Promise.all(promises);
    })
    .then(function() {
      response.send({status:'ok'});
    })
}

plugins.deleteProduct = async function(pluginId) {
  var product = null;
  return Product.load(pluginId)
    .then(function(prod){
      product = prod;
      if (pluginId == 'mc-controller') {
        throw new HttpError.BadRequest('Cannot remove the controller product');
      }
      if (product.links.devices.length) {
        throw new HttpError.BadRequest('Cannot remove a product until all devices are removed');
      }
    })
    .then(function(){
      return plugins.removeNodeRedPlugin(product);
    })
    .then(function(){
      return plugins.removeGrafanaPlugin(product);
    })
    .then(function(){
      return Product.delete(pluginId);
    })
}

// Routing table
// Implement in this order
// plugin.install     (put /plugins/:pluginId - will install or update)
//   - Grafana plugin
//   - Node-Red plugin
//   - Edge plugin (grafana,node-red,edge)
// plugin.inspect     (get /plugins/:pluginId)
// plugin.uninstall   (delete /plugins/:pluginId)
// plugin.update      (put /plugins/:pluginId or put /plugins to update all)
// plugin.search      (get /plugins with parameters)
plugins.get('/plugins', plugins.searchPlugins)
plugins.get('/plugins/:pluginId', plugins.getPlugin)
plugins.put('/plugins', AuthC.api, AuthZ.role('admin'), plugins.updatePlugins)
plugins.put('/plugins/:pluginId', AuthC.api, AuthZ.role('admin'), plugins.putPlugin)
plugins['delete']('/plugins/:pluginIds', AuthC.api, AuthZ.role('admin'), plugins.deletePlugins)