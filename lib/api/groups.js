var config = require('config').get('iot-edge');
var HttpError = require('httperrors')
var Router = require('express-promise-router')
var Request = require('request-promise')
var Group = require('../persist').Group;
var AuthC = require('../authenticate');
var AuthZ = require('../authorize');
var _ = require('lodash')
var URL = require('url');

var groups = module.exports = Router()

/**
 * Sanitize the input form.
 *
 * This defaults, translates, throws exceptions on error, and returns a sanitized resource
 */
groups.sanitizeInput = function(request) {

  var body = void 0
  return Promise.resolve()
    .then(function() {
      body = request.getParams({body:['*id','*type', 'name', '*description', '*watches', 'links']})

      if (body.type && body.type !== 'group') {
        throw new HttpError.BadRequest('Invalid resource type: ' + body.type)
      }
      body.type = 'group'

      if (body.id && request.method == 'POST') {
        throw new HttpError.BadRequest('Cannot provide resource ID on POST')
      }

      // TODO: Sanitize links

      return body;
    })
}

// Returns all groups
// Or a list of groups by id: ?ids=id,id,id...
groups.searchGroups = function(request, response) {
  var ids = request.getParams({query:['*ids']}).ids
  if (ids) {
    return groups.getMany(ids.split(','))
      .then(function(groups) {
        response.send(_.toArray(groups)); // keep requested ordering
      });
  }
  return Group.all()
    .then(function(groups) {
      var sorted = _.sortBy(groups,'name');
      response.send(sorted);
    });
}

// Return many groups (by id) into an array
groups.getMany = function(ids) {
  return Promise.resolve()
    .then(function() {
      var promises = [];
      ids.forEach(function(groupId) {
        promises.push(Group.load(groupId))
      })
      return Promise.all(promises);
    })
}

// Returns a group by id
groups.getGroup = function(request, response) {
  var groupId = request.getParams({url:['groupId']}).groupId
  return Group.load(groupId)
    .then(function(group) {
      response.send(group);
    });
}

// Implementations
groups.postGroup = function(request, response) {
  var group;
  return groups.sanitizeInput(request)
    .then(function(sanitized){
      group = new Group(sanitized);
      return group.save();
    })
    .then(function() {
      response.send(group)
    })
}

// Update a group
groups.putGroup = function(request, response) {
  var group;
  return groups.sanitizeInput(request)
    .then(function(sanitized){
      group = new Group(sanitized);
      return group.save();
    })
    .then(function(group) {
      response.send(group)
    })
}

groups.deleteGroups = function(request, response) {
  var groupIds = [];
  return Promise.resolve()
    .then(function(){
      groupIds = request.getParams({path:['groupIds']}).groupIds.split(',')
      return groups.getMany(groupIds);
    })
    .then(function(){
      var promises = [];
      groupIds.forEach(function(groupId){
        promises.push(Group.delete(groupId));
      });
      return Promise.all(promises);
    })
    .then(function() {
      response.send({status:'ok'});
    })
}

// Resolve a list of users and groups to a single array of unique user IDs
//
// The input is a list of hrefs to users and groups. It can be
//
// 1) A string, separated by commas
// 2) An array of hrefs
// 3) A links object, containing objects with hrefs
//
// @input members: (list of user and group hrefs user/{userId},group/{groupId})
// @returns [array of user IDs]
groups.resolveUserIds = async function(members) {
  let userIds = [];
  if (_.isString(members)) {
    members = members.split(',');
  }
  for (let i in members) {
    let member = members[i].trim();
    let parts = member.split('/');
    let type = parts[0];
    let id = parts[1];
    if (type === 'user' && id) {
      userIds.push(id);
    }
    else if (type === 'group' && id) {
      try {
        let group = await Group.fetch(id);
        for (var j in group.links.users) {
          userIds.push(group.links.users[j].href.split('/')[1]);
        }
      }
      catch (e) {
        console.error('Bad group (continuing): ' + id, e);
      }
    }
  }
  return _.compact(_.uniq(userIds));
}

// Routing table
groups.get('/groups', AuthC.session, AuthZ.role('admin'), groups.searchGroups)
groups.get('/groups/:groupId', AuthC.session, AuthZ.role('admin'), groups.getGroup)
groups.put('/groups/:groupId', AuthC.session, AuthZ.role('admin'), groups.putGroup)
groups.post('/groups', AuthC.session, AuthZ.role('admin'), groups.postGroup)
groups['delete']('/groups/:groupIds', AuthC.session, AuthZ.role('admin'), groups.deleteGroups)
