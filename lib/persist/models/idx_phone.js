var HttpError = require('httperrors');
/**
 * Phone number to user index
 */
var Base = require('../models/base');

var MODEL = {
  id: "",            // Normalized phone number (just numbers, including country code)
  type: "idxPhone",// Data model name
  links: {
    user: {}         // User associated with this index key. This must be the name of
                     // another data model, and if {} it's a unique index, and if
                     // [] then it's not a unique index.
  },
  meta: {}
}

/**
 * Constructor
 *
 * @param instance {Object} The raw JS object to instantiate this from
 */
var idxPhone = module.exports = function(instance) {

  var t = this;
  if (!t instanceof idxPhone) {
    return new idxPhone(instance);
  }

  // Call parent constructor
  idxPhone.super_.call(t, 'idxPhone', instance);

}
require('util').inherits(idxPhone, Base);
var proto = idxPhone.prototype;

// Expose statics to base
Base.models.idxPhone = MODEL;
Base.classes.idxPhone = idxPhone;
['load','loadIndexed','loadByHref','delete','all'].forEach(function(methodName) {
  idxPhone[methodName] = function() {return Base[methodName](MODEL.type, arguments);}
})

/**
 * Normalize a telephone number into a string for storage
 *
 * This is highly opinionated for +1 phone numbers: No extensions, 10 digits, optional +1
 *
 * - Trim the input
 * - Remove all non-numeric chars
 * - Add +1 if necessary
 * - Throw if bad length
 * - Return '+1nnnnnnnnnn'
 *
 * @method normalizePhone
 * @param phone {String} Phone number (as entered)
 * @returns normalized Normalized phone for comparison
 */
idxPhone.normalize = function(phone) {
  if (!phone) return ''
  var normalized = phone.replace(/[^0-9]/g,'')
  if (normalized.substr(0,1) !== '1') {
    normalized = '1' + normalized
  }
  if (normalized.length !== 11) {
    throw new HttpError.BadRequest('Invalid phone number: ' + phone)
  }
  return '+' + normalized
}
