const Router = require('express-promise-router')
const Program = require('../persist').Program;
const Group = require('../persist').Group;
const programs = module.exports = Router()
const HttpError = require('httperrors')
const AuthC = require('../authenticate');
const AuthZ = require('../authorize');
const _ = require('lodash');

// This provides a minimum object based on the input parameters
// Only required input parameter is programId in the url
programs.sanitizeInput = async function(request) {
/*
  var params = request.getParams({path:['programId'], body:['*name','*scheduling','*queries','*history','*links','*meta']});
  var program = new Program(programId);
  program.name = params.name || null;
  program.scheduling = params.scheduling || null;
  program.queries = params.queries || null;
  program.history = params.history || null;
  program.links = params.links || null;
  program.links.viewers = params.links.viewers || null;
  program.links.editors = params.links.editors || null;
  program.meta = params.meta || null;
*/
}

// Authorization middleware
programs.canViewProgram = async function(request, response, next) {
  var programId = request.getParams({path:['programId']}).programId;
  request.program = request.program || await Program.load(programId);
  AuthZ.verifyUserGroupAuth(request.user.id, request.program.links.viewers);
  next();
}
programs.canEditProgram = async function(request, response, next) {
  var programId = request.getParams({path:['programId']}).programId;
  request.program = request.program || await Program.load(programId);
  AuthZ.verifyUserGroupAuth(request.user.id, request.program.links.editors);
  next();
}

// Return the list of program definitions
programs.getList = async function(request, response) {

  let allPrograms = await Program.all();

  // Filter unauthorized programs
  for (var programId in allPrograms) {
    var program = allPrograms[programId];
    if (!(await AuthZ.isUserGroupAuthorized(request.user.id, program.links.viewers))) {
      delete allPrograms[programId];
    }
  }

  return response.send(_.values(allPrograms));
}

// Request a program definition
programs.getProgram = async function(request, response) {
  response.send(program);
}

// Save a program
programs.putProgram = async function(request, response) {
  // See if it's an add or an update
  var program = await program.sanitizeInput(request);

  // Merge into prior model if necessary
  var priorModel;
  try {
    priorModel = await Program.load(program.id);
  }
  catch(e) {}
  if (priorModel) {
/*
    program.scheduling = program.scheduling || priorModel.scheduling;
    program.queries = program.queries || priorModel.queries;
    program.history = program.history || priorModel.history;
    program.links.viewers = program.links.viewers || priorModel.links.viewers;
    program.links.editors = program.links.editors || priorModel.links.editors;
    program.meta = program.meta || priorModel.meta;
*/
  }

  // Persist and return
  await program.save();
  response.send(program);
}

// Remove a program
programs.deleteProgram = async function(request, response) {
  var programId = request.getParams({path:['programId']}).programId;
  await Program.delete(programId);
  response.send('deleted');
}

// Routing table
programs.get ('/programs', AuthC.api, programs.getList);
programs.get ('/programs/:programId', AuthC.api, programs.canViewProgram, programs.getProgram);
programs.put ('/programs/:programId', AuthC.api, programs.canEditProgram, programs.putProgram);
programs['delete']('/programs/:programId', AuthC.api, programs.canEditProgram, programs.deleteProgram);
