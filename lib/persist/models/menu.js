/**
 * A custom menu structure
 *
 * Menus are a tree structure with the top level being an array of MenuItems.
 *
 * (from mc-mobile/v2/src/components/multilevel-menu/menuItem.ts)
 *
 * export interface MenuItem {
 *   id?: string;           // Unique within the full menu tree
 *   name: string;          // Label the user sees
 *   icon?: string;         // One of the ionicons: https://ionicframework.com/docs/ionicons/
 *
 *   // Then exactly one of the following:
 * 
 *   // For webpage items
 *   slug?: string;         // Slug to show in url bar "page/:slug"
 *   url?: string;          // Full url of the framed web page
 * 
 *   // For site dashboards
 *   hubId?: string;        // Site ID
 *   dashId?: string;       // slug: /dash/:hubId/:dashId url: mc.com/:hubId/dashboard/db/:dashId
 * 
 *   // For internal pages
 *   page?: string;         // Page name (open non-modal)
 *   modalpage?: string;    // Page name (open modal)
 * 
 *   // For submenu item
 *   items?: MenuItem[];    // Sub-items (can't have above definitions)
 * }
 */
var Base = require('./base');

var MODEL = {
  id: "",            // Menu ID (uuid)
  type: "menu",      // Data model name
  name: "",          // Name of this full menu structure
  items: [],         // Array of MenuItem objects (see above)
  links: {},
  meta: {}
}

/**
 * Constructor
 *
 * @param instance {Object} The raw JS object to instantiate this from
 */
var menu = module.exports = function(instance) {

  var t = this;
  if (!t instanceof menu) {
    return new menu(instance);
  }

  // Call parent constructor
  menu.super_.call(t, 'menu', instance);

}
require('util').inherits(menu, Base);
var proto = menu.prototype;

// Expose statics to base
Base.models.menu = MODEL;
Base.classes.menu = menu;
['load','loadIndexed','loadByHref','delete','all'].forEach(function(methodName) {
  menu[methodName] = function() {return Base[methodName](MODEL.type, arguments);}
})
