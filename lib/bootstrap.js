var Promise = require('bluebird');
var config = require('config').get('iot-edge');
var logger = {info:function(a,b){console.log(b);}};
var Dashboard = require('./dashboard');
var Hub = require('./persist').Hub;
var Product = require('./persist').Product;
var Device = require('./persist').Device;
var Product = require('./persist').Product;
var Report = require('./persist').Report;
var Zone = require('./persist').Zone;
var ServicePlan = require('./persist').ServicePlan;
var products = require('./api/products');
var reports = require('./api/reports');
var calendar = require('./api/calendar');
var _ = require('lodash');

// Run this to make sure all app components are in place
var BOOT = module.exports = function() {
  return Promise.resolve()
    .then(BOOT.initSite)
    .then(BOOT.startTimeServices)
    .then(BOOT.startGrafana)
    .then(BOOT.verifyMcController)
    .then(BOOT.addDefaultProducts)
    .then(BOOT.addDefaultZone)
    .then(BOOT.updateServicePlan)
    .then(BOOT.persistDefaultReports)
    .then(reports.init)
    .then(calendar.init)
    .then(BOOT.updatePlugins)
    ;
};

// Initialize site
BOOT.initSite = function() {
  return Promise.resolve()
    .then(function(){
      return Hub.loadSingleton();
    })
    .catch (function(err) {
      // Bootstrap the hub node
      if (process.env.SITE_ID && err.name == 'NotFound' || err.name == 'InternalServerError') {
        var hub = new Hub({id:process.env.SITE_ID});
        if (process.env.SITE_NAME) {
          hub.name = process.env.SITE_NAME;
        }
        return hub.save();
      }
      throw err;
    })
};

// Time is an O/S level service, served on edge via ntpd
// On systems without an RTC, don't start until time services start
BOOT.startTimeServices = function() {

  // Return true if the clock isn't completely unreasonable (like Jan1 1970)
  var checkTime = function() {
    return (Date.now() > 1449443607581); // Somewhere around Dec.2015 when this was written
  }

  logger.info('boot', 'Verifying time services');
  return new Promise(function(resolve, reject) {
    if (checkTime()) {
      return resolve();
    }
    var numTries = 0;
    var timer = setInterval(function(){
      logger.info('boot', 'Waiting for the O/S clock to be set');
      if (numTries++ > 20) {
        clearInterval(timer);
        var err = new Error('O/S clock not set properly: ' + Date());
        return reject(err);
      }
      if (checkTime()) {
        clearInterval(timer);
        return resolve();
      }
    }, 5000);
  });
};

// Make sure the grafana dashboard is ready to go
BOOT.startGrafana = function() {
  logger.info('boot', 'Initializing grafana');
  return Dashboard.init();
};

BOOT.verifyMcController = function() {
  logger.info('boot', 'Verifying mc-controller plugin');
  return Device.load('mc-controller')
    .catch(function(err){
      if (err.NotFound) {
        return BOOT.loadMcController();
      }
    })
};

BOOT.addDefaultProducts = function() {
  // TODO: Change this to default plugins
  // var defaultProducts = ["mc-cam", "mc-th"];
  var defaultProducts = [];
  logger.info('boot', 'Verifying default products exist');
  return Product.all()
    .then(function(products){
      var chain = Promise.resolve();
      var allWork = [];
      _.each(defaultProducts, function(productId) {
        if (!_.find(products, ['id', productId])) {
          var p = new Product(productId);
          chain = chain.then(function() {p.save()});
        }
      })
      return chain;
    });
};

BOOT.addDefaultZone = function() {
  return Zone.all()
    .then(function(zones){
      var numZones = 0;
      _.forOwn(zones, function() {numZones++});
      if (numZones == 0) {
        var newZone = new Zone({
          name: 'Zone 1',
          dashSlug: 'zone-1'
        })
        return newZone.save();
      }
      return;
    });
};

// This hardcodes site plan characteristics
BOOT.updateServicePlan = function() {
  return ServicePlan.loadSingleton()
    .then(function(plan) {
      var oldPlan = JSON.stringify(plan);
      if (plan.id == "STARTER") {
        plan.maxCams = 2;
        plan.maxDevices = 10;
        plan.camImageRetention_minute = "1_month_delete";
        plan.camImageRetention_hour = "6_month_delete";
        plan.reportRetention = "6_month_delete";
        plan.alertImageRetention = "3_month_delete";
        plan.backupRetention_partial = "1_month_delete";
        plan.backupRetention_full = "6_month_delete";
      }
      else if (plan.id == "BUSINESS") {
        plan.maxCams = 4;
        plan.maxDevices = 30;
        plan.camImageRetention_minute = "3_month_delete";
        plan.camImageRetention_hour = "1_year_delete";
        plan.reportRetention = "1_year_delete";
        plan.alertImageRetention = "6_month_delete";
        plan.backupRetention_partial = "3_month_delete";
        plan.backupRetention_full = "1_year_delete";
      }
      else if (plan.id == "INDUSTRIAL") {
        plan.maxCams = 8;
        plan.maxDevices = 100;
        plan.camImageRetention_minute = "6_month_archive";
        plan.camImageRetention_hour = "2_year_archive";
        plan.reportRetention = "2_year_archive";
        plan.alertImageRetention = "6_month_archive";
        plan.backupRetention_partial = "3_month_archive";
        plan.backupRetention_full = "1_year_archive";
      }
      if (oldPlan != JSON.stringify(plan)) {
        logger.info('boot', 'Updating service plan characteristics');
        return plan.save();
      }
      return;
    })
    .catch(function(e) {})
};

BOOT.persistDefaultReports = async function() {
  let allReports = await Report.all();
  if (!allReports.dashboard) {
    newReport = new Report({
      id:"dashboard",
      name:"Dashboards",
      authUsers: [],
      authGroups: [],
      scheduling: [],
      queries: {
        "default": {
          dashName: "",
          dashUuid: null,
          width: 1024,
          from: "",
          to: "",
          theme: "light",
          hideHeading: false,
        }
      },
    });
    allReports.dashboard = await newReport.save();
  }
  if (!allReports.panel) {
    newReport = new Report({
      id:"panel",
      name:"Dashboard Panels",
      scheduling: [],
      queries: {
        "default": {
          dashName: "mobile-co2-1",
          dashUuid: null,
          panel: 5,
          width: 1024,
          height: 500,
          from: "",
          to: "",
          theme: "light",
        }
      },
    });
    allReports.panel = await newReport.save();
  }
}

BOOT.updatePlugins = function() {
  logger.info('boot', 'Checking for updates in plug-in components');
  // Don't return the promise. Allow server to start even on plug-in update error.
  products.updateAllProducts()
    .catch(function(err){
      console.error('Error updating plug-ins. Continuing bootstrap. Err: ', err);
    })
  return Promise.resolve();
};

BOOT.loadMcController = function() {
  logger.info('boot', 'Loading mc-controller plugin');
  var products = require('./api/products');
  var devices = require('./api/devices');
  var product, device;
  return devices.scanByModule('mc-controller')
    .then(function(scanned){
      device = scanned[0];
      product = device.product;
      device.name = device.name || product.name;
      return products.install(product, '!latest');
    })
    .then(function() {
      return devices.update(product, device)
    })
    .then(function() {
      delete device.product;
      return device.save();
    })
};
