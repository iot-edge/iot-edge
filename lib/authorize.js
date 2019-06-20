const _ = require('lodash')
const HttpError = require('httperrors')
const LEVELS = {guest: 1, monitor: 2, controller: 3, admin: 4, owner: 5}
const groupsCache = null;
const NODE_RED_URL = '/' + process.env.SITE_ID + '/node-red';
const GRAPHITE_URL = '/' + process.env.SITE_ID + '/graphite';
const PUBLIC_RESOURCES = [
  '/favicon.ico',
  '/' + process.env.SITE_ID + '/favicon.ico',
  '/' + process.env.SITE_ID + '/login',
  '/' + process.env.SITE_ID + '/public/*',
  '/' + process.env.SITE_ID + '/docs/*',
];

/**
 * Request authorization module
 */
var AuthZ = module.exports = {}

/**
 * Authorize the inbound request.
 * This returns true if authorized, false if not authorized
 * 
 * Backend services that have their own auth are let through:
 *   Graphite - built-in auth
 *   Edge server - internal auth based on X-WEBAUTH-USER and X-WEBAUTH-ROLE
 *   Plugin API - via /api/plugin/... - internal auth based on X-WEBAUTH-USER and X-WEBAUTH-ROLE
 * 
 * Dev resources (graphite, node-red) are authorized at 1 higher auth level:
 *   Role:Admin - Allow everything
 *   Role:Editor - Allow READ but no WRITE
 *   Role:Viewer - No READ or WRITE
 */
AuthZ.authorize = async function(request, response) {

  let isAuthorized = false;
  let role = (request.user && request.user.role) || 'Viewer';
  let method = request.method;
  let url = request.get('x-original-uri');
  let isMutating = (method == 'put' || method == 'post' || method == 'delete');
  let isProtected = (url.indexOf(NODE_RED_URL) == 0 || url.indexOf(GRAPHITE_URL) == 0);

  if (isProtected) {
    isAuthorized = (role == 'Admin' || role == 'Editor' && !isMutating);
  }
  else {
    isAuthorized = true;
  }
  return isAuthorized;
}

/**
 * Return TRUE if the request is to a known public resource
 */
AuthZ.isPublicResource = function(url) {
  for (var i in PUBLIC_RESOURCES) {
    if (url.match(PUBLIC_RESOURCES[i])) {
      return true;
    };
  }
  return false;
}

/**
 * Authorize everyone, regardless of their origin, cookies, etc.
 */
AuthZ.all = function(request, response, next) {next()}

/**
 * Authorize based on hub role
 *
 * Example:
 *   AuthZ.role('admin')
 *
 * @method role
 * @param roleName {String} The hub role to authorize
 */
AuthZ.role = function(roleName) {
  var roleLevel = LEVELS[roleName];
  if (_.isUndefined(roleLevel)) {
    throw new HttpError[500]('Unknown role name: ' + roleName);
  }
  return function(request, response, next) {
    var userLevel = LEVELS[request.user && request.user.roles] || 0;
    if (userLevel >= roleLevel) {
      return next();
    }
    throw new HttpError.Forbidden('Not authorized to perform this task')
  }
}

/**
 * Is the specified user authorized based on the auth links?
 *
 * User/group authorization is usually stored in an array of links to
 * users and user groups. This method takes the specified user and matches
 * that person against the specified list of links to users/groups.
 *
 * If the list is empty, the user is authorized
 * If the user is directly in the list, the user is authorized
 * If the user is in ANY of the groups in the list, the user is authorized
 *
 * If the user is authorized, the function returns
 * If the user is unauthorized, an HttpError is thrown.
 *
 * Example:
 *   if (AuthZ.isUserGroupAuthorized(request.user.id, report.links.editors)) {
 *     ...
 *   }
 *
 * @method isUserGroupAuthorized
 * @param userId {String} The ID of the user to test is authorized
 * @param userGroupLinks {String[]} Array of link objects containing ["user/{id}", "group/{id}", ...]
 */
AuthZ.isUserGroupAuthorized = async function(userId, userGroupLinks) {

  // User is required
  if (!userId) {
    return false;
  }

  // Authorized if no users/groups specified
  if (!userGroupLinks || userGroupLinks.length == 0) {
    return true;
  }

  // Is user directly authorized
  let linkHref = "user/" + userId;
  if (_.find(userGroupLinks, function(userLink) {return userLink.href == linkHref;})) {
    return true;
  }

  // Is user indirectly authorized via a group
  var allGroups = await AuthZ.getAllGroups();
  let isAuthorized = false;
  _.each(userGroupLinks, function(userGroupLink) {
    var parts = userGroupLink.href.split('/');
    if (parts[0] == 'group') {
      var groupId = parts[1];
      var group = allGroups[groupId];
      if (group && _.find(group.links.users, function(userLink) {return userLink.href == linkHref;})) {
        isAuthorized = true;
      }
    }
  })

  return isAuthorized;
}

/**
 * Throw an HttpError if the specified user isn't authorized.
 *
 * See AuthZ.isUserGroupAuthorized for more information
 *
 * Example:
 *   AuthZ.verifyUserGroupAuth(request.user.id, report.links.editors));
 *
 * @method verifyUserGroupAuth
 * @param userId {String} The ID of the user to test is authorized
 * @param userGroupLinks {String[]} Array of link objects containing ["user/{id}", "group/{id}", ...]
 */
AuthZ.verifyUserGroupAuth = async function(userId, userGroupLinks) {
  if (!await AuthZ.isUserGroupAuthorized(userId, userGroupLinks)) {
    throw HttpException.Unauthorized("Not authorized");
  }
}

// Self flushing groups cache
AuthZ.getAllGroups = async function() {
  if (!groupsCache) {
    groupsCache = await Group.all();
    setTimeout(function() {
      groupsCache = null;
    }, 5000);
  }
  return groupsCache;
}
