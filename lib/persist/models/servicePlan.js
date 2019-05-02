/**
 * A servicePlan that a site can be associated with
 */
var Base = require('./base');
var HttpError = require('httperrors');
var _ = require('lodash');

/**
 * Constructor
 *
 * @param instance {Object} The raw JS object to instantiate this from
 */
var servicePlan = module.exports = function(instance) {
  var t = this;
  if (!t instanceof servicePlan) { return new servicePlan(instance); }
  servicePlan.super_.call(t, 'servicePlan', instance);
}
require('util').inherits(servicePlan, Base);
var proto = servicePlan.prototype;

var MODEL = {
  id: "",            // Unique servicePlan ID (short name)
  type: "servicePlan",  // Data model name
  name: "",          // Service plan name

  monthlyAmount: 0,  // If paying monthly
  annualAmount: 0,   // If paying annually
  maxCams: 2,
  maxDevices: 10,

  // These end up as S3 'retention' tags {period}_{resolution} where
  // {period} is 1_month, 3_month, 6_month, 1_year, or 2_year and {resolution} is archive or delete
  // Default values are for the minimum service plan
  // NOTE: If period values other than month/year, add to servicePlan.numDays() below
  camImageRetention_minute: '1_month_delete',
  camImageRetention_hour: '6_month_delete',
  reportRetention: '6_month_delete',
  alertImageRetention: '3_month_delete',
  backupRetention_partial: '1_month_delete',
  backupRetention_full: '6_month_delete',

  links: {
  },
  meta: {}
}

// Get the singleton. Create if necessary.
servicePlan.loadSingleton = function() {
  return servicePlan.all()
    .then(function(plans) {
      var plan = null;
      _.each(plans, function(p){plan = p});
      if (_.size(plans) != 1) {
        throw HttpError[500]('servicePlan not a singleton (' + _.size(plans) + ')');
      }
      return plan;
    })
}

// Helper to return general number of days from a retetion string
servicePlan.numDays = function(retentionValue) {
  let parts = retentionValue.split('_');
  let num = +parts[0];
  let period = parts[1];
  let onePeriodDays = period == 'month' ? 31 : 365; // Periods can be only month/year
  return num * onePeriodDays;
}

// Expose statics to base
Base.models.servicePlan = MODEL;
Base.classes.servicePlan = servicePlan;
['load','loadIndexed','loadByHref','delete','all'].forEach(function(methodName) {
  servicePlan[methodName] = function() {return Base[methodName](MODEL.type, arguments);}
})
