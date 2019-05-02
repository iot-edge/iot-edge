var _ = require('lodash')
var HttpError = require('httperrors')
var LEVELS = {
  guest: 1,
  monitor: 2,
  controller: 3,
  admin: 4,
  owner: 5
}

// Temporary groups cache
var groupsCache = null;

/**
 * oAuth token based authorization
 */
var AuthZ = module.exports = {}

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
