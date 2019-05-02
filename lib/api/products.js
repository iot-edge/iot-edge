var Promise = require('bluebird');
var HttpError = require('httperrors')
var Router = require('express-promise-router')
var Request = require('request-promise')
var Product = require('../persist').Product;
var Device = require('../persist').Device;
var Hub = require('../persist').Hub;
var Dashboard = require('../dashboard');
var nodered = require('../node-red');
var cp = Promise.promisifyAll(require('child_process'));
var fs = Promise.promisifyAll(require('fs'));
var config = require('config').get('iot-edge');
var nodeRedUrl = 'http://' + config.get('nodered.host') + ':' + config.get('nodered.port') + config.get('nodered.path');
var _ = require('lodash')
var REGISTRY = "https://microclimates.com:422";
var FLOW_LIB = '/mnt/node-red/lib/flows';

var products = module.exports = Router()

/**
 * Sanitize the input form.
 *
 * This defaults, translates, throws exceptions on error, and returns a sanitized resource
 */
products.sanitizeInput = function(request) {

  var body = void 0
  return Promise.resolve()
    .then(function() {
      body = request.getParams({path:['*productId'], body:['*id','*type','*name','*manufacturer', 'url', '*version', '*links','newDeviceName','deviceDashSlug','installer','*meta']})

      if (body.type && body.type !== 'product') {
        throw new HttpError.BadRequest('Invalid resource type: ' + body.type)
      }
      body.type = 'product'

      if (body.productId && body.id && (body.productId != body.id)) {
        throw new HttpError.BadRequest('Cannot change product ID')
      }
      if (body.productId) {
        body.id = body.productId;
        delete body.productId;
      }

      // TODO: Sanitize links
      return body;
    })
}

// Create and install a product
products.postProduct = function(request, response) {
  var productId;
  return products.sanitizeInput(request)
    .then(function(sanitized){
      productId = sanitized.id;
      return Product.load(productId);
    })
    .then(function(existing) {
      throw new HttpError.Conflict('Product already exists with ID: ' + product.id + ' - Name: ' + existing.name);
    })
    .catch(function(err) {
      if (err.name == 'Conflict') { throw err; }
      return products.loadFromNPM(productId);
    })
    .then(function(newProduct) {
      return products.install(newProduct, 'latest');
    })
    .then(function(newProduct) {
      return response.send(newProduct);
    })
}

// Insert or update a product
products.putProduct = function(request, response) {
  var product;
  var prior;
  return products.sanitizeInput(request)
    .then(function(sanitized){
      product = new Product(sanitized);
      return Product.load(product.id);
    })
    .catch(function(err) {
      if (err.statusCode == 404) {
        // Insert the product
        return products.loadFromNPM(product.id)
          .then(function(newProd) {
            product = new Product(newProd);
            product.version = 'latest';
            return newProd;
          })
      }
      throw err;
    })

    // Process changes
    .then(function(oldProduct){
      prior = oldProduct;

      // Are we requesting a version change?
      if (prior.version !== product.version) {
        return products.install(prior, product.version);
      }

      // Trust the new product is valid
      return product.save();
    })
    .then(function(product) {
      response.send(product)
    })
}

// Check for and install product updates
products.updateProduct = function(request, response) {
  var productId = request.params.productId;
  return products.updateProductById(productId)
    .then(function(product) {
      response.send(product)
    })
}

// Check for and install product updates
products.updateProducts = function(request, response) {
  return products.updateAllProducts()
    .then(function() {
      response.send({status:"ok"})
    })
}

// Check for and install product updates
products.updateAllProducts = function() {
  return Product.all()
    .then(function(allProducts) {
      var chain = Promise.resolve();
      _.each(allProducts, function(product) {
        chain = chain.then(function(){return products.updateProductById(product.id)});
      })
      return chain;
    })
}

// Update a product if there's a newer version
products.updateProductById = function(productId) {
  return Product.load(productId)
    .then(function(product) {
      return products.install(product, 'latest');
    })
}

// Install or update
products.install = function(product, tag) {
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
      return products.loadFromNPM(product.id);
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
      return products.updateDeviceConfigs(product);
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
      return products.installGrafanaPlugin(product);
    })
    .catch(function(err) {
      if (!err.NotFound) {
        console.error('Error installing grafana plugin:', err);
      }
      throw err;
    })
    .then(function(){
      console.log('Installing node-red plugins');
      return products.installNodeRedPlugin(product);
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
      return products.rebuildDeviceDashboards(product);
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

products.updateDeviceConfigs = function (product) {
  return product.loadLinked('devices')
    .then(function(devices) {
      var chain = Promise.resolve();
      _.each(devices, function(device) {
        chain = chain.then(function(){return products.updateDeviceConfig(product, device)});
      })
      return chain;
    })
}

products.updateDeviceConfig = function (product, device) {
  device.config = device.config || {};
  device.limits = device.limits || {};
  _.defaultsDeep(device.config, product.defaultConfig);
  _.defaultsDeep(device.limits, product.defaultLimits);
  return device.save();
}

products.rebuildDeviceDashboards = function (product) {
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

products.installGrafanaPlugin = function(product) {
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
            return products.importDashboard(product, dash.path)
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

products.removeGrafanaPlugin = function(product) {
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

products.importDashboard = function(product, dashPath) {
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

products.installNodeRedPlugin = function(product) {
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
      return products.updateAllFlows(product);
    })
    .catch(function(err) {
      if (err.code == 'NOENT' || err.statusCode == 404) {
        return;
      }
      console.error('Error installing node-red components for ' + product.id, err);
      throw err;
    })
}

products.removeNodeRedPlugin = function(product) {
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

products.updateAllFlows = function(product) {
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
      return products.updateDeviceFlows(product);
    })
}

products.updateDeviceFlows = function(product) {
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

// Returns all products
// Or a list of products by id: ?ids=id,id,id...
products.searchProducts = function(request, response) {
  var query = request.getParams({query:['*ids']});
  var ids = query.ids;
  var promise;
  if (ids) {
    promise = products.getMany(ids.split(','));
  }
  else {
    promise = Product.all();
  }
  return promise
    .then(function(products) {
      response.send(_.toArray(products));
    });
}

// Return many products (by id) into an array
products.getMany = function(ids) {
  return Promise.resolve()
    .then(function() {
      var promises = [];
      ids.forEach(function(productId) {
        promises.push(Product.load(productId))
      })
      return Promise.all(promises);
    })
}

// Returns a product by id. Installs if ?install
products.getProduct = function(request, response) {
  var productId = request.getParams({url:['productId']}).productId
  return Product.load(productId)
    .then(function(product) {
      response.send(product);
    });
}

// Load a product from NPM
products.loadFromNPM = function(moduleId) {
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
products.loadDeviceDash = function(product) {
  return Promise.resolve()
    .then(function() {
      if (product.deviceDashSlug) {
        return Dashboard.load(product.deviceDashSlug);
      }
      return null;
    })
}

products.deleteProducts = function(request, response) {
  var productIds = [];
  return Promise.resolve()
    .then(function(){
      var promises = [];
      productIds = request.getParams({path:['productIds']}).productIds.split(',')
      productIds.forEach(function(productId){
        promises.push(products.deleteProduct(productId));
      });
      return Promise.all(promises);
    })
    .then(function() {
      response.send({status:'ok'});
    })
}

products.deleteProduct = function(productId) {
  var product = null;
  return Product.load(productId)
    .then(function(prod){
      product = prod;
      if (productId == 'mc-controller') {
        throw new HttpError.BadRequest('Cannot remove the controller product');
      }
      if (product.links.devices.length) {
        throw new HttpError.BadRequest('Cannot remove a product until all devices are removed');
      }
    })
    .then(function(){
      return products.removeNodeRedPlugin(product);
    })
    .then(function(){
      return products.removeGrafanaPlugin(product);
    })
    .then(function(){
      return Product.delete(productId);
    })
}

// Routing table
products.get('/products', products.searchProducts)
products.put('/products/update', products.updateProducts)
products.put('/products/update/:productId', products.updateProduct)
products.post('/products', products.postProduct)
products.get('/products/:productId', products.getProduct)
products.put('/products/:productId', products.putProduct)
products['delete']('/products/:productIds', products.deleteProducts)
