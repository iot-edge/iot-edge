var HttpError = require('httperrors');
/**
 * Email address to user index
 */
var Base = require('../models/base');

var MODEL = {
  id: "",            // Normalized email (all lowercase, space stripped)
  type: "idxEmail",  // Data model name
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
var idxEmail = module.exports = function(instance) {

  var t = this;
  if (!t instanceof idxEmail) {
    return new idxEmail(instance);
  }

  // Call parent constructor
  idxEmail.super_.call(t, 'idxEmail', instance);

}
require('util').inherits(idxEmail, Base);
var proto = idxEmail.prototype;

// Expose statics to base
Base.models.idxEmail = MODEL;
Base.classes.idxEmail = idxEmail;
['load','loadIndexed','loadByHref','delete','all'].forEach(function(methodName) {
  idxEmail[methodName] = function() {return Base[methodName](MODEL.type, arguments);}
})

/**
 * Normalize an email into a string for indexing
 *
 * This also validates the email and throws a BadRequest if poorly formatted
 *
 * - Trim the input
 * - Lowercase the input
 * - Throw if not name@site.tld
 * - Return a clean input
 *
 * @method normalize
 * @param email {String} Email address (as stored)
 * @returns normalized Normalized email for indexing
 */
idxEmail.normalize = function(email) {
  if (!email) return ''
  var normalized = email.trim().toLowerCase()
  var parts = normalized.split('@')
  if (parts.length !== 2) {
    throw new HttpError.BadRequest('Invalid email format: ' + email)
  }
  parts[0] = parts[0].trim()
  parts[1] = parts[1].trim()
  if (parts[1].split('.').length < 2) {
    throw new HttpError.BadRequest('Invalid email domain: ' + email)
  }
  return parts.join('@')
}
