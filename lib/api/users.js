var HttpError = require('httperrors')
var Router = require('express-promise-router')
var Request = require('request-promise')
var User = require('../persist').User;
var Hub = require('../persist').Hub;
var AuthC = require('../authenticate');
var AuthZ = require('../authorize');
var _ = require('lodash')
var Dashboard = require('../dashboard');

var users = module.exports = Router()

/**
 * Sanitize the input form.
 *
 * This defaults, translates, throws exceptions on error, and returns a sanitized resource
 */
users.sanitizeInput = function(request) {

  var body = void 0
  return Promise.resolve()
    .then(function() {
      body = request.getParams({body:['*id','*type', 'firstName','*lastName','*email','*phone', 'roles', '*watches', '*links', '*meta']})

      if (body.type && body.type !== 'user') {
        throw new HttpError.BadRequest('Invalid resource type: ' + body.type)
      }
      body.type = 'user'

      if (!body.email && !body.phone) {
        throw new HttpError.BadRequest('Must specify at least email or phone')
      }

      if (body.id && request.method == 'POST') {
        throw new HttpError.BadRequest('Cannot provide resource ID on POST')
      }

      // TODO: Sanitize links
      return users.dupCheck(body);
    })
}

users.dupCheck = function(user) {
  return User.all()
    .then(function(users) {
      var found = _.find(users, {email:user.email});
      if (user.email && found && found.id !== user.id) {
        throw new HttpError.BadRequest('User with this email already exists')
      }
      found = _.find(users, {phone:user.phone});
      if (user.phone && found && found.id !== user.id) {
        throw new HttpError.BadRequest('User with this phone already exists')
      }
      return user;
    })
}

// Add a new user
users.postUser = function(request, response) {
  var user = new User();
  return users.sanitizeInput(request)
    .then(function(sanitized){
      _.extend(user, sanitized);
    })
    .then(function() {
      return users.addUserToGrafana(user);
    })
    .then(function() {
      return user.save();
    })
    .then(function() {
      response.send(user)
    })
}

// Resolves with the grafana user ID, or NULL if no grafana user with this email
users.findGrafanaUserId = function(user) {
  return Request(Dashboard.makeURI('/api/org/users'))
    .then((rsp)=>{
      // Returns an array of {orgId: 1, userId: 1, email: "admin@localhost", avatarUrl: "/public/img/user_profile.png",…}
      var parsed = JSON.parse(rsp);
      var grafanaUser = _.find(parsed, function(usr) {return usr.email == user.email});
      if (grafanaUser) {
        return grafanaUser.userId;
      }
      return null;
    })
}

users.addUserToGrafana = async function(user) {

  // See if the grafana user already exists
  if (user.grafanaId) {return;}
  let grafanaId = await users.findGrafanaUserId(user);
  if (grafanaId) {
    user.grafanaId = grafanaId;
    await users.updateUserRoleInGrafana(user);
    return;
  }

  // Create the user
  var grafanaUser = {
    name: user.firstName + ' ' + user.lastName,
    email: user.email,
    login: user.email,
    password: 'a' + Math.floor(Math.random() * 100000000000)
  }
  var config = {
    uri: Dashboard.makeURI('/api/admin/users'),
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(grafanaUser)
  }
  return Request(config)
    .then(function(rsp) {
      var parsed = JSON.parse(rsp);
      user.grafanaId = parsed.id;
    })
    .catch(function(err) {
      console.error(err);
      throw new HttpError.ServiceUnavailable('Error adding user to grafana', err.message);
    })
    .then(()=> {
      return users.updateUserRoleInGrafana(user);
    })
}

users.updateUserRoleInGrafana = function(user) {
  var grafanaRole;
  if (user.roles == 'admin' || user.roles == 'owner') {
    grafanaRole = 'Admin';
  } else if (user.roles == 'controller') {
    grafanaRole = 'Editor';
  } else {
    grafanaRole = 'Viewer';
  }
  var patchData = {
    orgId: 1,
    role: grafanaRole
  }
  var config = {
    uri: Dashboard.makeURI('/api/orgs/1/users/' + user.grafanaId),
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(patchData)
  }
  return Request(config)
    .catch(function(err) {
      throw new HttpError.ServiceUnavailable('Error modifying user role in grafana', err.message);
    })
}

// Update a user
users.putUser = function(request, response) {
  var userId = request.params.userId;
  var user = null;
  var priorRole = null;
  return User.load(userId)
    .catch(function(err){
      if (!err.NotFound) {throw err}
      return new User({id: userId})
    })
    .then(function(prior){
      user = prior;
      priorRole = prior.roles;
      return users.sanitizeInput(request);
    })
    .then(function(sanitized){
      _.extend(user, sanitized);
      if (!user.grafanaId) {
        return users.addUserToGrafana(user);
      }
    })
    .then(function() {
      if (priorRole && user.roles != priorRole) {
        return users.updateRole(user);
      }
    })
    .then(function() {
      return user.save();
    })
    .then(function() {
      response.send(user)
    })
}

users.updateRole = function(user) {
  return Promise.resolve()
    //TODO: Publish an updateUserRole message
    //      and handle as a plugin
    /*
    .then(function(){
      // Update the cloud
      return McCloud.requestWithSessionCreds({
        url: '/account/hub_user/' + process.env.SITE_ID + '/' + userId,
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          role: user.roles
        }),
        method: 'PUT'
      }, request)
    })
    */
    .then(function() {
      // Update grafana
      return users.updateUserRoleInGrafana(user);
    })
    .then(function() {
      // Set the hub owner
      if (user.roles == 'owner') {
        return Hub.loadSingleton()
          .then(function(hub) {
            hub.addLink('owner', user);
            return hub.save();
          })
      }
    })
}

// Returns all users
// Or a list of users by id: ?ids=id,id,id...
users.searchUsers = function(request, response) {
  var ids = request.getParams({query:['*ids']}).ids
  if (ids) {
    return users.getMany(ids.split(','))
      .then(function(users) {
        response.send(_.toArray(users)); // keep requested ordering
      });
  }
  return User.all()
    .then(function(users) {
      var sorted = _.sortBy(users,'order');
      response.send(sorted);
    });
}

// Return many users (by id) into an array
users.getMany = function(ids) {
  return Promise.resolve()
    .then(function() {
      var promises = [];
      ids.forEach(function(userId) {
        promises.push(User.load(userId))
      })
      return Promise.all(promises);
    })
}

// Returns a user by id
users.getUser = function(request, response) {
  var userId = request.getParams({url:['userId']}).userId
  return User.load(userId)
    .then(function(user) {
      response.send(user);
    });
}

users.deleteUsers = function(request, response) {
  var userIds = [];
  return Promise.resolve()
    .then(function(){
      userIds = request.getParams({path:['userIds']}).userIds.split(',')
      var promises = [];
      userIds.forEach(function(userId){
        promises.push(users.deleteUser(userId, request));
      });
      return Promise.all(promises);
    })
    .then(function() {
      response.send({status:'ok'});
    })
}

users.deleteUser = function(userId, request) {
  return User.load(userId)
    //TODO: Publish a deleteUser message on the bus
    //      and handle with a plugin.
    /*
    .then(function(user){
      return McCloud.requestWithSessionCreds({
        url: '/account/hub_user/' + process.env.SITE_ID + '/' + userId,
        method: 'DELETE'
      }, request);
    })
    */
    .then(function() {
      return User.delete(userId);
    })
}

// MC Cloud integration
// * Fetch a user ID from cloud using email/phone
// * Register/De-register a user with this hub
// * Send an invite
// ** All in 1 call?
users.getIdByEmailOrPhone = function(user) {
}

// Routing table
users.get('/users', AuthC.session, AuthZ.role('admin'), users.searchUsers)
users.get('/users/:userId', AuthC.session, AuthZ.role('admin'), users.getUser)
users.put('/users/:userId', AuthC.session, users.putUser); // TODO: Authorize as admin - or - the userId
users.post('/users', AuthC.session, AuthZ.role('admin'), users.postUser)
users['delete']('/users/:userIds', AuthC.session, AuthZ.role('admin'), users.deleteUsers)
