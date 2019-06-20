var config = require('config').get('iot-edge');
var HttpError = require('httperrors')
var Router = require('express-promise-router')
var Request = require('request-promise')
var fs = require('fs');
var _ = require('lodash')
var nodered = require('../node-red');
var AuthC = require('../authenticate');
var AuthZ = require('../authorize');
var flows = module.exports = Router()

// A flow is an array of associated node-red nodes, combined onto a tab.

// Returns all flows
// Or a flow by name: ?name=name
flows.searchFlows = function(request, response) {
  var query = request.getParams({query:['*name']});
  return nodered.loadFlows()
    .then(function(flows) {
      var allFlows = flows.flows;
      if (query.name) {
        return nodered.getFlowByName(query.name, flows);
      }
      return allFlows;
    })
    .then(function(returnNodes) {
      response.send(returnNodes);
    });
}

// Get a flow
flows.getFlow = function(request, response) {
  var flowId = request.getParams({url:['flowId']}).flowId
  return nodered.getFlowById(flowId)
    .then(function(flow) {
      response.send(flow);
    });
}

// Add or update a flow
flows.putFlow = function(request, response) {
  var flowId = request.getParams({url:['flowId']}).flowId
  return Promise.resolve()
    .then(function(){
      var flow = request.body;
      return nodered.updateFlow(flowId, flow);
    })
    .then(function(updatedFlow) {
      response.send(updatedFlow)
    })
}

// Delete a flow
flows.deleteFlow = function(request, response) {
  var flowId = request.getParams({url:['flowId']}).flowId
  return nodered.deleteFlow(flowId)
    .then(function(deleted) {
      response.send({status:"deleted"});
    });
}

// Routing table
flows.get('/flows', flows.searchFlows);
flows.get('/flows/:flowId', flows.getFlow);
flows.put('/flows/:flowId', AuthC.api, AuthZ.role('admin'), flows.putFlow);
// flows.post('/flows', AuthC.api, AuthZ.role('admin'), flows.postFlow);
flows['delete']('/flows/:flowId', AuthC.api, AuthZ.role('admin'), flows.deleteFlow);
