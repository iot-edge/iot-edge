var Promise = require('bluebird');
var HttpError = require('httperrors')
var Request = require('request-promise')
var config = require('config').get('iot-edge');
var fs = Promise.promisifyAll(require('fs'));
var _ = require('lodash')

var NODE_RED_URL = 'http://' + config.get('nodered.host') + ':' + config.get('nodered.port') + config.get('nodered.path');
var MQTT_BROKER = {
  "id": "mc.mqtt.broker",
  "type": "mqtt-broker",
  "broker": "mqtt",
  "port": "1883",
  "clientid": "",
  "usetls": false,
  "compatmode": false,
  "keepalive": "60",
  "cleansession": true,
  "z": "",
  "willTopic": "",
  "willQos": "0",
  "willPayload": "",
  "birthTopic": "",
  "birthQos": "0",
  "birthPayload": ""
};
var POST_HEADERS = {
  'content-type': 'application/json',
  'Node-RED-API-Version': 'v2'
};

// Node-Red utilities
var nodered = module.exports = {};
nodered.MQTT_BROKER = MQTT_BROKER;

// Merge a flow template from a file, merge into flows, and write to node-red
nodered.mergeTemplate = function(flowId, flowName, flowTitle, templateFilename, dataModel) {
  var newFlow = null;
  return Promise.resolve()
    .then(function(){
      return fs.readFileAsync(templateFilename)
    })
    .then(function(flowTemplate) {
console.log('Merging template: ' + templateFilename);

      // Apply the data model to the template
      var compiled = _.template(flowTemplate);
      newFlow = JSON.parse(compiled(dataModel));

      // Don't allow tabs in the template
      _.remove(newFlow, {type: 'tab'});

      // Add the readonly comment nodes
      var commentNode = {
        id: flowId + '-auto-comment-1', type: 'comment', 
        name: 'Auto generated - DO NOT EDIT',
        info: 'This flow is overwritten on software updates and settings changes. Any changes made to it will be lost.',
        x: 170, y:40, z: flowId, wires:[],
      };
      _.remove(newFlow, {name: commentNode.name});
      newFlow.splice(0,0,commentNode);
      commentNode = {
        id: flowId + '-auto-comment-2', type: 'comment', 
        name: flowTitle,
        info: 'Flow generated: ' + (new Date().toLocaleString()),
        x: 490, y:40, z: flowId, wires:[],
      };
      _.remove(newFlow, {name: commentNode.name});
      newFlow.splice(1,0,commentNode);

      // Assign all flow nodes to this flow
      _.each(newFlow, function(node) {
        if (node.z) {
          node.z = flowId;
        }
      });

      // Add the flow tab
      newFlow.push({
        id: flowId, type: 'tab', label: flowName
      })

      // Persist the flow
      return nodered.updateFlow(flowId, newFlow);
    })
    .catch(function(err) {
      // OK if no template
      if (err.code == 'ENOENT') {return}
      throw err;
    })
}

nodered.updateFlow = function(flowId, newFlow, flows) {
  var flowsFromDB = null;
  return Promise.resolve()
    .then(function() {
      return flows ? flows : nodered.loadFlows();
    })
    .then(function(flows){
      flowsFromDB = flows;
      var allFlows = flowsFromDB.flows;

      // Remove all nodes from the same flow
      _.remove(allFlows, {z:flowId});

      // Don't replace existing global elements
      _.forEach(allFlows, function(elem) {
        if (!elem.z) {
          _.remove(newFlow, {id: elem.id});
        }
      })

      // Merge new elems
      Array.prototype.push.apply(allFlows, newFlow);

      // Add the mqtt broker if not defined
      if (!_.find(allFlows, {id: MQTT_BROKER.id})) {
        allFlows.push(MQTT_BROKER);
      }

      // Persist
      return nodered.saveFlows(flowsFromDB);
    })
    .then(function(flows) {
      return newFlow;
    })
}

// Delete the specified flow by ID
nodered.deleteFlow = function(flowId, flows) {
  var flowsFromDB = null;
  return Promise.resolve()
    .then(function() {
      return flows ? flows : nodered.loadFlows();
    })
    .then(function(flows){
      flowsFromDB = flows;
      var allFlows = flowsFromDB.flows;
      _.remove(allFlows, function(elem) {
        return (elem.id == flowId || elem.z == flowId);
      })
      return nodered.saveFlows(flowsFromDB);
    })
}

// Get a flow by ID
// flows is optional
nodered.getFlowById = function(id, flows) {
  return Promise.resolve()
    .then(function() {
      return flows ? flows : nodered.loadFlows();
    })
    .then(function(flows) {
      return _.filter(flows.flows, function(node) {
        return (node.id == id || node.z == id);
      })
    })
}

// Get a flow by name
// flows is optional
nodered.getFlowByName = function(name, flows) {
  return Promise.resolve()
    .then(function() {
      return flows ? flows : nodered.loadFlows();
    })
    .then(function(flows) {
      var allFlows = flows.flows;
      var found = _.filter(allFlows, function(node) {
        return (node.type == 'tab' && node.label == name) || (node.type == 'subflow' && node.name == name);
      });
      if (found.length) {
        return nodered.getFlowById(found[0].id, flows);
      }
      throw new HttpError.NotFound('No flow found with name: ' + name);
    })
}

// Load flows. 
// Resolves to {flows: [...], rev: {revision}}
nodered.loadFlows = function() {
  var params = {
    url: NODE_RED_URL + '/flows',
    method: 'GET',
    headers: POST_HEADERS
  }
  return Request(params)
    .then(function(flows) {
      return JSON.parse(flows);
    })
}

// Save flows.
nodered.saveFlows = function(flows) {
  return Promise.resolve()
    .then(function(){
      var params = {
        url: NODE_RED_URL + '/flows',
        method: 'POST',
        headers: _.extend({
          'Node-RED-Deployment-Type': 'full',
          'X-Requested-With': 'XMLHttpRequest' 
        }, POST_HEADERS),
        body: JSON.stringify(flows)
      }
      return Request(params);
    })
    .then(function(rsp) {
      // Update the revision
      flows.rev = JSON.parse(rsp).rev;
      return flows;
    })
}
