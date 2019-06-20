const Router = require('express-promise-router')
const getRequest = require('util').promisify(require('request').get);
/*
var AuthC = require('../authenticate');
var AuthZ = require('../authorize');
var _ = require('lodash')
*/
var loggedIn = false;

/**
 * These endpoints are for nginx auth using ngx_http_auth_request_module
 * 
 * They return 200 if authorized, 401 if not authenticated, 403 if authenticated but not authorized
 */
const auth = module.exports = Router()

// Available responses
auth.respondOK = function(response) {
  response.set('X-WEBAUTH-USER', 'admin');
  response.status(200).send('');
}
auth.respondNotAuthenticated = function(response) {response.status(401).send('')}
auth.respondNotAuthorized = function(response) {response.status(403).send('')}

// Read a non-protected resource. Requires login.
// 1) Get the Authorization header
// 2) Key the header value with an object containing promises for each method
//    readProtected, readNonProtected, writeMyResource, writeResource, and writeAdminResource
// 3) 

// Handle all auth requests
auth.all = async function(request, response) {

  // Authenticate
  let user = await auth.authenticate(request);
  if (!user) {
    return response.status(401).send('');
  }

  // Authorize
  if (!await auth.authorize(request)) {
    return response.status(403).send('');
  }

  // Good to go
  response.set('X-WEBAUTH-USER', user.id);
  response.set('X-WEBAUTH-USERNAME', user.name.replace(' ','-'));
  return response.status(200).send('');

  let isAuthorized = await auth.authorize(request);
  let hashKey = auth.computeHashKey
  console.log('method:', request.method);
  console.log('url:', request.get('x-original-uri'));
  // console.log('headers:', request.headers);
  // Remove upper x-webauth-user
  if (!loggedIn) {
    loggedIn = true;
    auth.respondNotAuthenticated(response);
  }
  else {
    auth.respondOK(response);
  }
  // auth.respondOK(response);
}

auth.authorize = async function(request) {
}

auth.authenticate = async function(request) {
}