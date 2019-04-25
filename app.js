#!/usr/bin/env node
const config = require('config').get('iot-edge');
const start = Date.now();
console.log(
'_____      _____         _________                    \n' +
'___(_)_______  /_   ___________  /______ _____        \n' +
'__  /_  __ \\  __/   _  _ \\  __  /__  __ `/  _ \\    \n' +
'_  / / /_/ / /_     /  __/ /_/ / _  /_/ //  __/       \n' +
'/_/  \\____/\\__/     \\___/\\__,_/  _\\__, / \\___/  \n' +
'                                 /____/                 ');

const http = require('http');

const port = config.server.port;
const interface = config.server.interface;
const externalHttpPort = config.get('externalExposure.httpPort');
const externalMqttPort = config.get('externalExposure.mqttPort');

const server = http.createServer((req, res) => {
  res.statusCode = 200;
  res.setHeader('Content-Type', 'text/plain');
  res.end('Hello World\n');
});

server.listen(port, interface, () => {
  console.log('');
  console.log(`Edge server available at http://localhost:${externalHttpPort}/`);
  console.log(`MQTT server listening on port ${externalMqttPort}`);
  console.log('');
});
