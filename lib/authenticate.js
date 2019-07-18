const _ = require('lodash');
const Promise = require('bluebird');
const Request = Promise.promisify(require('request'));
const Dashboard = require('./dashboard');
const ApiKey = require('./persist/models/apiKey');
const User = require('./persist/models/user');
const HttpError = require('httperrors');
const LOGIN_URL = '/' + process.env.SITE_ID + '/login'
const LOGOUT_URL = '/' + process.env.SITE_ID + '/logout'
const GRAFANA_SESSION_COOKIE = 'grafana_sess_' + process.env.SITE_ID;
const CACHE_TTL_MS = 1 * 1000 * 60 * 60;

// Token cache is a name/value pairing of cache key to a promise that resolves a user object
const TOKEN_CACHE = {};

/**
 * Authentication module
 */
var AuthC = module.exports = {};

/**
 * Authenticate the request.
 * This returns a user model instance
 */
AuthC.authenticate = async function(request) {

  let url = request.get('x-original-uri');
  let headerAuth = request.get('authorization');
  let cookieAuth = request.cookies[GRAFANA_SESSION_COOKIE];
  let authToken = headerAuth ? headerAuth : cookieAuth;

  // Unknown user if no API or Session cookie, or attempting to login (regardless of auth)
  if (!authToken || url == LOGIN_URL) {
    return null;
  }

  // Clear cache on logout
  if (url === LOGOUT_URL) {
    delete TOKEN_CACHE[authToken];
  }

  // Quickly resolve if authToken is cached
  let cacheEntry = TOKEN_CACHE[authToken];
  if (cacheEntry && cacheEntry.expires > Date.now()) {
    return cacheEntry;
  }

  // Cache and return the promise
  cacheEntry = TOKEN_CACHE[authToken] = (headerAuth ? AuthC.headerAuth(authToken) : AuthC.cookieAuth(authToken));
  cacheEntry.expires = Date.now() + CACHE_TTL_MS;
  return cacheEntry;
}

AuthC.headerAuth = async function(authToken) {
  let tokenParts = authToken.split(' ');
  let tokenType = tokenParts[0];
  let tokenValue = tokenParts[1];

  if (tokenType == 'Basic') {
    let authHeaders = {
      'Authorization': authToken
    }
    return await AuthC.userFromAuthHeaders(authHeaders);
  }
  else if (tokenType == 'Bearer') {
    return await AuthC.apiKeyFromAuthToken(tokenValue);
  }

  console.error('Unknown auth token type: ' + authToken);
  return null;
}

AuthC.cookieAuth = async function(authToken) {
  let authHeaders = {
    'Cookie': GRAFANA_SESSION_COOKIE + '=' + authToken
  }
  return await AuthC.userFromAuthHeaders(authHeaders);
}

// Return the current User object based on auth headers
AuthC.userFromAuthHeaders = async function(authHeaders) {

  let grafanaUser, currentOrg, user;
  try {

    // Get the actual user
    let params = {
      url: Dashboard.makeURI('/api/user'),
      headers: authHeaders
    }
    let rsp = await Request(params);
    grafanaUser = JSON.parse(rsp.body);

    // Get the user role for the current logged in org
    params.url = Dashboard.makeURI('/api/user/orgs');
    rsp = await Request(params);
    let userOrgs = JSON.parse(rsp.body);
    currentOrg = _.find(userOrgs, ['orgId', grafanaUser.orgId]);
    if (!currentOrg) {throw "User not found in current org " + grafanaUser.orgId}
  }
  catch (e) {
    console.error('Auth error for headers: ' + JSON.stringify(authHeaders), e);
    throw new HttpError.Unauthorized('Invalid user auth');
  }

  // Add or update the User object
  try {
    user = await User.load('' + grafanaUser.id);
    if (user.name != grafanaUser.name 
     || user.login != grafanaUser.login
     || user.email != grafanaUser.email
     || user.role != currentOrg.role
    ) {
      user.name = grafanaUser.name;
      user.login = grafanaUser.login;
      user.email = grafanaUser.email;
      user.role = currentOrg.role;
      await user.save();
    }
  }
  catch (e) {
    user = new User({
      id: '' + grafanaUser.id,
      name: grafanaUser.name,
      login: grafanaUser.login,
      email: grafanaUser.email,
      role: currentOrg.role
    });
    await user.save();
  }

  return user;
}

// Return an ApiKey object from the grafana API key
AuthC.apiKeyFromAuthToken = async function(authToken) {
  // Base64 decode the authToken
  // Grafana results in {"k":"Aq35fIQRtC5mmT4Rfj5HTuddVO4XyFIu","n":"API Key Name","id":2}
  let tokenJson, apiKeyId, key, apiKey;
  try {
    tokenJson = new Buffer(authToken, 'base64').toString('ascii');
    apiKeyId = JSON.parse(tokenJson).id;
  }
  catch (e) {
    throw new HttpError.Unauthorized('Invalid auth token');
  }

  // Load all apiKeys from Grafana. This validates the apiKey and refreshes data.
  try {
    let params = {
      url: Dashboard.makeURI('/api/auth/keys'),
      headers: {
        'Authorization': 'Bearer ' + authToken
      }
    }
    let rsp = await Request(params);
    let apiKeys = JSON.parse(rsp.body);
    key = _.find(apiKeys, ['id', apiKeyId]);
    if (!key) {throw "No keys match"}
  }
  catch (e) {
    console.error('Auth error for token: ' + authToken + ' : ' + tokenJson, e);
    throw new HttpError.Unauthorized('Invalid auth token');
  }

  // Add or update the ApiKey object
  try {
    apiKey = await ApiKey.load(apiKeyId);
    if (apiKey.name != key.name || apiKey.role != key.role) {
      apiKey.name = key.name;
      apiKey.role = key.role;
      await apiKey.save();
    } 
  }
  catch (e) {
    apiKey = new ApiKey({
      id: '' + apiKeyId,
      name: key.name,
      role: key.role
    });
    await apiKey.save();
  }

  return apiKey;
}

// Auth middleware for user determined from nginx auth proxy (above)
AuthC.api = AuthC.session = async function(request, response, next) {
  let userId = request.get('X-WEBAUTH-USER');
  if (!userId || userId == '-') {
    throw new HttpError.Unauthorized('No user ID')
  }
  if (userId.indexOf('API_KEY-') == 0) {
    request.user = await ApiKey.load(userId.substr(8));
  }
  else {
    request.user = await User.load(userId);
  }
  next();
}