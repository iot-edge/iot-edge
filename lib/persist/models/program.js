/**
 * A program is a set of content representing a topic, delivered in a channel
 *
 * Programs can be shared across channels, so they have their own authorization.
 * Channels cannot be less restrictive than the programs they contain.
 *
 */
var Base = require('./base');

/**
 * Constructor
 *
 * Content Item: An array of these are stored in contentItems array
 * Structure of contentItem: 
 * {
 *   menuItem: {...},    // See menu.js for the structure of MenuItem - contains name. First item = program icon.
 *   durationSecs: 10,   // Seconds to stay on this menu item before auto-moving to the next
 * }
 *
 * @param instance {Object} The raw JS object to instantiate this from
 */
var program = module.exports = function(instance) {
  var t = this;
  if (!t instanceof program) { return new program(instance); }
  program.super_.call(t, 'program', instance);
}
require('util').inherits(program, Base);
var proto = program.prototype;

var MODEL = {
  id: "",            // Unique program id
  type: "program",   // Data model name
  name: "",          // program advertised name
  description: "",   // Long description of the program content
  topics: [],        // List of program topic tags
  contentItems:[],   // Array of contentItem records (see above)
  public: false,     // Does the program allow guest viewing?
  links: {
    viewers: [],     // List of users/groups authorized to view program content (empty = all site users)
    editors: [],     // List of users/groups authorized to edit program content (empty = all site users)
  },
  meta: {}
}

// Expose statics to base
Base.models.program = MODEL;
Base.classes.program = program;
['load','loadIndexed','loadByHref','delete','all'].forEach(function(methodName) {
  program[methodName] = function() {return Base[methodName](MODEL.type, arguments);}
})
