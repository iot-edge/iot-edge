#!/usr/bin/env node
//
// _____      _____         _________             
// ___(_)_______  /_   ___________  /______ _____ 
// __  /_  __ \  __/   _  _ \  __  /__  __ `/  _ \
// _  / / /_/ / /_     /  __/ /_/ / _  /_/ //  __/
// /_/  \____/\__/     \___/\__,_/  _\__, / \___/ 
//                                  /____/        
//
// The following gobbledeegook is an attempt to produce the above in a log viewer
console.log(
  '                                 /____/               \n' +
  '/_/  \\____/\\__/     \\___/\\__,_/  _\\__, / \\___/  \n' +
  '_  / / /_/ / /_     /  __/ /_/ / _  /_/ //  __/       \n' +
  '__  /_  __ \\  __/   _  _ \\  __  /__  __ `/  _ \\    \n' +
  '___(_)_______  /_   ___________  /______ _____        \n' +
  '_____      _____         _________                      ');

var config = require('config').get('iot-edge')
var start = Date.now()

// Export as a full app
var app = module.exports = require('express')()

// Common middleware
app.use(require('express-domain-middleware'))
app.use(require('response-time')())
app.use(require('morgan')(config.get('morgan.logType'), config.get('morgan.config')))
app.use(require('cors')())
app.use(require('compression')())
app.use(require('cookie-parser')())
app.use(require('body-parser').text())
app.use(require('body-parser').json())
app.use(require('body-parser').urlencoded({ extended: true }))
app.use(require('./lib/middleware').addRequestID())
app.use(require('./lib/middleware').addPoweredBy('iot-edge server'))
app.use(require('./lib/middleware').addMetaSupport())
app.use(require('./lib/middleware').addResponseCookies())
app.use(require('./lib/middleware').addConsistentParameterProcessing())

app.use('/', require('./index'))
app.get('/status', require('./lib/status').getStatus)

// Final error handling
app.use(require('./lib/middleware').finalErrorHandler())

// Start the server
require('./lib/bootstrap')()
  .then(function() {
    var http = require('http')
    var fqdn = config.get('externalExposure.fqdn')
    var externalPort = config.get('externalExposure.httpPort')
    var internalPort = config.get('server.port')
    var interface = config.get('server.interface')
    var server = http.createServer(app)
    var io = require('socket.io')(server);
    require('./lib/socket-io')(io);
    server.listen(internalPort, interface)
    console.log('Startup in ' + (Date.now() - start) + 'ms.')
    console.log(`⚡⚡ Edge server available on http://${fqdn}:${externalPort}/ ⚡⚡`)
  })
  .catch(function(err) {
    console.error('Problem starting edge server. Restarting in 10 seconds.');
    console.error(err);
    setTimeout(function(){
      process.exit(1);
    }, 10000);
  })
