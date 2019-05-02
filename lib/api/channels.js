const Router = require('express-promise-router')
const Channel = require('../persist').Channel;
const Group = require('../persist').Group;
const channels = module.exports = Router()
const HttpError = require('httperrors')
const AuthC = require('../authenticate');
const AuthZ = require('../authorize');
const _ = require('lodash');

// This provides a minimum object based on the input parameters
// Only required input parameter is channelId in the url
channels.sanitizeInput = async function(request) {
/*
  var params = request.getParams({path:['channelId'], body:['*name','*scheduling','*queries','*history','*links','*meta']});
  var channel = new Channel(channelId);
  channel.name = params.name || null;
  channel.scheduling = params.scheduling || null;
  channel.queries = params.queries || null;
  channel.history = params.history || null;
  channel.links = params.links || null;
  channel.links.viewers = params.links.viewers || null;
  channel.links.editors = params.links.editors || null;
  channel.meta = params.meta || null;
*/
}

// Authorization middleware
channels.canViewChannel = async function(request, response, next) {
  var channelId = request.getParams({path:['channelId']}).channelId;
  request.channel = request.channel || await Channel.load(channelId);
  AuthZ.verifyUserGroupAuth(request.user.id, request.channel.links.viewers);
  next();
}
channels.canEditChannel = async function(request, response, next) {
  var channelId = request.getParams({path:['channelId']}).channelId;
  request.channel = request.channel || await Channel.load(channelId);
  AuthZ.verifyUserGroupAuth(request.user.id, request.channel.links.editors);
  next();
}

// Return the list of channel definitions
channels.getList = async function(request, response) {

  let allChannels = await Channel.all();

  // Filter unauthorized channels
  for (var channelId in allChannels) {
    var channel = allChannels[channelId];
    if (!(await AuthZ.isUserGroupAuthorized(request.user.id, channel.links.viewers))) {
      delete allChannels[channelId];
    }
  }

  return response.send(_.values(allChannels));
}

// Request a channel definition
channels.getChannel = async function(request, response) {
  response.send(channel);
}

// Save a channel
channels.putChannel = async function(request, response) {
  // See if it's an add or an update
  var channel = await channel.sanitizeInput(request);

  // Merge into prior model if necessary
  var priorModel;
  try {
    priorModel = await Channel.load(channel.id);
  }
  catch(e) {}
  if (priorModel) {
/*
    channel.scheduling = channel.scheduling || priorModel.scheduling;
    channel.queries = channel.queries || priorModel.queries;
    channel.history = channel.history || priorModel.history;
    channel.links.viewers = channel.links.viewers || priorModel.links.viewers;
    channel.links.editors = channel.links.editors || priorModel.links.editors;
    channel.meta = channel.meta || priorModel.meta;
*/
  }

  // Persist and return
  await channel.save();
  response.send(channel);
}

// Remove a channel
channels.deleteChannel = async function(request, response) {
  var channelId = request.getParams({path:['channelId']}).channelId;
  await Channel.delete(channelId);
  response.send('deleted');
}

// Routing table
channels.get ('/channels', AuthC.api, channels.getList);
channels.get ('/channels/:channelId', AuthC.api, channels.canViewChannel, channels.getChannel);
channels.put ('/channels/:channelId', AuthC.api, channels.canEditChannel, channels.putChannel);
channels['delete']('/channels/:channelId', AuthC.api, channels.canEditChannel, channels.deleteChannel);
