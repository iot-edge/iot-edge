var config = require('config').get('iot-edge');
var HttpError = require('httperrors')
var Router = require('express-promise-router')
var url = require('url');
var mqtt = require('mqtt');
var mqttServer = 'mqtt://mqtt:' + config.get('externalExposure.mqttPort');
var AuthC = require('../authenticate');
var AuthZ = require('../authorize');
var _ = require('lodash')
var DEFAULT_TIMEOUT_SECS = 60;
let topicListeners = {}; // Key = topic, Data = mqttConnection

var databus = module.exports = Router()

// Controlled interface to the MQTT data bus

// Get the last (or next) message on this topic
// Params:
//   timeout: timeout in seconds (default 60)
//   verbose: return {topic:'', message:''} vs. 'message'. Good for wildcards.
//   fresh: boolean (wait for a fresh new message if initial message was retained)
databus.getNextMessage = async function(topic, params) {
  topic = topic || '#';
  params = params || {};
  var timeoutMs = +(params.timeout || DEFAULT_TIMEOUT_SECS) * 1000;
  var fresh = (params.fresh === true || params.fresh == 'true');
  var verbose = params.verbose;
  var responseSent = false;
  return new Promise(function(resolve, reject) {
    var client  = mqtt.connect(mqttServer);

    // Don't wait forever
    var timeout = setTimeout(function() {
      if (!responseSent) {
        responseSent = true;
        reject(new Error('timeout'));
      }
    }, timeoutMs);

    client.on('connect', function() {
      client.subscribe(topic);
    })
    client.on('packetreceive', function (packet) {
      if (!responseSent) {
        if (packet.cmd !== 'publish') {return}
        var topic = packet.topic;
        var payload = packet.payload.toString();
        if (fresh && packet.retain) {
          // Skip the first message if retained
          fresh = false;
          return;
        }
        responseSent = true;
        var responseMsg = payload;
        if (verbose) {
          responseMsg = {topic: topic, message: payload};
        }
        client.end()
        clearTimeout(timeout);
        resolve(responseMsg);
      }
    })
    client.on('error', function() {
      if (!responseSent) {
        responseSent = true;
        clearTimeout(timeout);
        client.end()
        reject(new Error('mqtt_connect_error'));
      }
    })
  })
}

// Get the last (or next) message on this topic
databus.getTopic = function(request, response) {
  var paramList = ['*topic','*timeout','*verbose','*fresh'];
  var params = request.getParams({query:paramList, body:paramList});
  return databus.getNextMessage(params.topic, params)
    .then(function(msg) {
      response.send(msg);
    })
    .catch(function(err) {
      console.error('MQTT Error: ', err);
      response.status(500).send({status:'mqtt_connect_error'});
    })
}

// Post a message
// topic: topic to post message to
// payload: message to post
// params: {
//   qos (number): QOS level
//   retain (boolean): Retain the message?
// }
databus.postMessage = async function(topic, payload, params = {}) {
  return new Promise((resolve, reject) => {
    var responseSent = false;
    var retain = (params.retain === true || params.retain == 'true');
    var qos = +(params.qos);
    qos = (qos >=0 && qos <=2) ? qos : 0;
    if (!topic || !payload) {
      return reject(new HttpError[400]('Must provide topic and payload'));
    }
    var client  = mqtt.connect(mqttServer);
    client.on('connect', function() {
      var opts = {
        qos: qos,
        retain: retain
      }
      client.publish(topic, payload, opts, function(err) {
        if (responseSent) {return}
        responseSent = true;
        if (err) {
          return reject(new HttpError[500]('mqtt_publish_error'));
        }
        return resolve({topic:topic, msg: 'sent'});
        client.end()
      });
    })
    client.on('error', function() {
      if (responseSent) {return}
      responseSent = true;
      client.end()
      reject(new HttpError[500]('mqtt_connect_error'));
    })
  })
}

// Post to a topic (endpoint)
databus.postTopic = async function(request, response) {
  var paramList = ['*topic','*payload','*retain'];
  var params = request.getParams({query:paramList, body:paramList});
  var topic = params.topic;
  var payload = params.payload;
  var retain = (params.retain === true || params.retain == 'true');
  var qos = +(params.qos);
  return databus.postMessage(topic, payload, {qos:qos, retain:retain})
    .then((msg)=>{
      return response.send(msg);
    })
}

// SocketIO - Watch an MQTT topic
// This gets a new mqtt client for each connection
databus.socketConnect = function(socket) {
  var request = socket.conn.request;
  var subscribeTopic = url.parse(request.url, true).query.topic;
  if (!subscribeTopic) {
    socket.emit('error', 'No Topic');
    return;
  }
  var mqttClient  = mqtt.connect(mqttServer);
  mqttClient.on('connect', function() {
    mqttClient.subscribe(subscribeTopic);
  })
  mqttClient.on('packetreceive', function (packet) {
    if (packet.cmd !== 'publish') {return}
    var topic = packet.topic;
    var payload = packet.payload.toString();
    var responseMsg = {topic: topic, message: payload};
    socket.emit('message', responseMsg);
  })
  mqttClient.on('error', function(err) {
    socket.emit('error', err);
  })
  socket.on('disconnect', function() {
    mqttClient.end();
  })
}

// Register a listener for a topic
databus.onTopic = function(topic, fn) {
  var client = topicListeners[topic];
  if (!client) {
    client = topicListeners[topic] = mqtt.connect(mqttServer);
    client.onTopicListeners = [];
    client.on('connect', function() {
      client.subscribe(topic);
    })
    client.on('packetreceive', function (packet) {
      if (packet.cmd !== 'publish') {return}
      var payload = packet.payload.toString();
      try {payload = JSON.parse(payload)} catch (e){}
      var listenerObj = {onTopic: topic, topic:packet.topic, payload:payload, packet:packet}
      _.each(client.onTopicListeners, function(listener) {
        listener(listenerObj);
      })
    })
    client.on('error', function(msg) {
      console.error('MQTT error while listening on topic: ', topic);
    })
  }
  client.onTopicListeners.push(fn);
}

// De-register a listener for a topic
databus.offTopic = function(topic, fn) {
  var client = topicListeners[topic];
  if (client) {
    var num = 0;
    client.onTopicListeners.forEach(function(listener) {
      if (listener === fn) {
        client.onTopicListeners.splice(num, 1);
        num--;
      }
      num++;
    });
    if (_.size(client.onTopicListeners) == 0) {
      client.end();
      delete topicListeners[topic];
    }
  }
}

// Routing table
databus.get('/databus', AuthC.session, databus.getTopic)
databus.post('/databus', AuthC.session, AuthZ.role('controller'), databus.postTopic)
databus.socket = databus.socketConnect;
