/**
 * A channel is a content delivery mechanism.
 *
 * Channels contain a list of Programs, each having their own set of permissions.
 * The channel cannot be less restrictive than the sum of their program content restrictions.
 */
var Base = require('./base');

/**
 * Constructor
 *
 * @param instance {Object} The raw JS object to instantiate this from
 */
var channel = module.exports = function(instance) {
  var t = this;
  if (!t instanceof channel) { return new channel(instance); }
  channel.super_.call(t, 'channel', instance);
}
require('util').inherits(channel, Base);
var proto = channel.prototype;

var MODEL = {
  id: "",            // Unique channel id
  type: "channel",   // Data model name
  name: "",          // Channel advertised name
  icon: "",          // One of the ionicons: https://ionicframework.com/docs/ionicons/
  description: "",   // Long description of the channel content
  topics: [],        // List of channel topic tags
  repeating: true,   // Does the channel repeat when done?
  public: false,     // Does the channel allow guest viewing?
  links: {
    liveSchedule: {},// CalendarItem representing a live channel
                     // All viewers are synched (see the same program)
                     // Only channel and authors can drive nav across programs
                     // Viewers can drive nav within a program
                     // First (intro) program is displayed outside the live schedule
    programs: [],    // List of programs the channel delivers.
    viewers: [],     // List of users/groups authorized to view channel content (empty = all site users)
    editors: [],     // List of users/groups authorized to edit channel content (empty = all site users)
  },
  meta: {}
}

// Expose statics to base
Base.models.channel = MODEL;
Base.classes.channel = channel;
['load','loadIndexed','loadByHref','delete','all'].forEach(function(methodName) {
  channel[methodName] = function() {return Base[methodName](MODEL.type, arguments);}
})
