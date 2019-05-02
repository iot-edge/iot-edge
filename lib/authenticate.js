var Promise = require('bluebird');
var HttpError = require('httperrors');
var _ = require('lodash');
var SESSION_COOKIE = '__mc_session'
var User = require('./persist').User;
var Session = require('./persist').Session;

/**
 * Authentication methods
 */
var AuthC = module.exports = {};

/**
 * API authentication from the tunnel via mc.com/api/v*
 */
AuthC.api = function(request, response, next) {
  var sessionId = request.getParams({cookie:['*'+SESSION_COOKIE]})[SESSION_COOKIE]
  if (sessionId) {
    return AuthC.session(request, response, next);
  }

  // No session cookie & no tunnel cookies. Could be calling internal from nodered.
  // This won't set request.user.
  if (!request.cookies || !request.cookies.userId) {return next();}

  var userFromCookie = { 
    id: request.cookies.userId,
    name: request.cookies.userName,
    role: request.cookies.role,
  }
  return User.load(userFromCookie.id)
    .then(function(user) {
      request.user = user;
      next()
    })  
    .catch(function(err) {
      request.user = userFromCookie;
      next()
    })  
}

/**
 * Browser session based authentication
 *
 * This sets request.user based on browser session, as set by the account
 * in the cloud. It persists this session in local cache so subsequent
 * requests aren't so heavyweight, and cloud connections can go away 
 * without rendering local terminals useless.
 */
AuthC.session = function(request, response, next) {
  var sessionId = request.getParams({cookie:['*'+SESSION_COOKIE]})[SESSION_COOKIE]
  return Promise.resolve()
    .then(function(){
      if (!sessionId) {
        throw new HttpError.Unauthorized('No session')
      }
      return Session.load(sessionId);
    })
    .catch(function(err) {
      if (err.NotFound) {
        return AuthC.sessionFromCloud(request, sessionId);
      }
      throw err;
    })
    .then(function(session){
      request.session = session
      return session.loadLinked('user')
    })
    .catch(function(err) {
      if (err.NotFound) {
        // Session present, but not user. Maybe user left without closing session.
        return AuthC.sessionFromCloud(request, sessionId)
          .then(function(session) {
            request.session = session;
            return session.loadLinked('user')
          })
      }
      throw err;
    })
    .then(function(user){
      request.user = user;
      return next();
    })
    .catch(function(err) {
      console.error('Session error: ', err);
      throw HttpError.Unauthorized('User login not found');
    })
}

/**
 * Get session from the cloud
 *
 * This creates and returns a local session based on auth creds from the cloud.
 */
AuthC.sessionFromCloud = function(request, sessionId) {
  //TODO: Rework external authorization to proxy to grafana auth
  /*
  var cloudUser;
  return Promise.resolve()
    .then(function(){
      var params = {
        url: '/account/hub_user/' + config.get('site.id')
      }
      return McCloud.requestWithSessionCreds(params, request);
    })
    .then(function(user) {
      cloudUser = JSON.parse(user);
      cloudUser.roles = cloudUser.role;
      delete cloudUser.role;
      return AuthC.findUserByEmailOrPhone(cloudUser.email, cloudUser.phone, request);
    })
    .catch(function(err) {
      if (err.NotFound) {
        var user = new User();
        _.extend(user, cloudUser);
        return user.save();
      }
      throw err;
    })
    .then(function(user) {
      var session = new Session({id: sessionId});
      session.addLink('user', user);
      return session.save();
    })
    */
}

/**
 * Indexed user find
 *
 * This accepts a raw phone number or email as entered by a user, and sets
 * the user into the request, or throws a NotFound error
 *
 * @method findUserByEmailOrPhone
 * @param email {String} User email (as entered)
 * @param phone {String} User phone (as entered)
 * @param [request] {object} The request object to place the user into (optional)
 * @returns promise Resolved user placed into the request object. Rejected if notfound or email/phone format error
 */
AuthC.findUserByEmailOrPhone = function(email, phone, request) {
  return Promise.resolve()
    .then(function() {
      if (email) {
        return User.loadIndexed('email', email)
      }
      else {
        return User.loadIndexed('phone', phone)
      }
    })
    .catch(function(err) {
      // Try phone if both email and phone, but didn't find by email
      if (email && phone) {
        return User.loadIndexed('phone', phone)
      }
      throw err;
    })
    .catch(function(err) {
      console.error('No user found by email/phone: "' + email + '" / "' + phone + '"');
      throw HttpError.NotFound('User not found in this hub by Email or Phone');
    })
    .then(function(user) {
      if (request) {
        request.user = user
      }
      return user
    })
}
