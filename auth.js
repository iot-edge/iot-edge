#!/usr/bin/env node
console.log('Auth server starting...');
const start = Date.now()

const config = require('config').get('iot-edge')
const fqdn = config.get('externalExposure.fqdn')
const internalPort = (+config.get('server.port') + 1);
const interface = config.get('server.interface')
const AuthC = require('./lib/authenticate');
const AuthZ = require('./lib/authorize');

var app = module.exports = require('express')()
app.use(require('cookie-parser')());
app.get('/status', require('./lib/status').getStatus)
app.all('/auth', async function(request, response) {
  try {
    // Authenticate
    let user = await AuthC.authenticate(request);
    if (!user) {

      // Unknown user
      response.set('X-WEBAUTH-USER', '-');
      response.set('X-WEBAUTH-USERNAME', 'noauth');
      response.set('X-WEBAUTH-ROLE', 'Viewer');

      // Redirect to login unless this is a known public url
      let url = request.get('x-original-uri');
      if (url && AuthZ.isPublicResource(url)) {
        return response.status(200).send('');
      }
      return response.status(401).send('');
    }

    // Known user or API key
    request.user = user;
    response.set('X-WEBAUTH-USER', user.type == 'apiKey' ? 'API_KEY-' + user.id : user.id);
    response.set('X-WEBAUTH-USERNAME', user.name ? user.name.replace(/ /g,'-') : user.login || 'unknown');
    response.set('X-WEBAUTH-ROLE', user.role);

    // Authorize
    if (!await AuthZ.authorize(request)) {
      return response.status(403).send('');
    }

    // Good to go
    return response.status(200).send('');
  }
  catch (e) {
    // Auth problem
    console.error('Auth error', e)
    let status = e.status || 500;
    response.status(status).send('');
  }
});

var http = require('http')
var server = http.createServer(app)
server.listen(internalPort, interface)
console.log('Auth server startup in ' + (Date.now() - start) + 'ms.')
console.log(`⚡⚡ Authenticating on http://${fqdn}:${internalPort}/auth ⚡⚡`)