var Promise = require('bluebird');
var config = require('config').get('iot-edge');
var HttpError = require('httperrors')
var fs = require('fs');
var exec = require('child_process').exec;
var mkdirp = Promise.promisify(require('mkdirp'));
var uuid = require('uuid');
var _ = require('lodash')
var nullFn = function() {};

// Change CMD_DIR in bin/cmd_processor scripts if this changes
var CMD_DIR = '/mnt/edge/command';
var INPUT_DIR = CMD_DIR + '/input';
var OUTPUT_DIR = CMD_DIR + '/output';

// InFlight commands {key:cmdId, data:true);
var inFlight = {};

// Command processor - runs commands on the raw O/S
var CP = module.exports = {};

// Run an O/S command as a client
// Returns promise resolve(stdout, stderr)
CP.exec = function(cmd) {
  var execId = uuid.v4();
  var inFile = INPUT_DIR + '/' + execId;
  var outFile = OUTPUT_DIR + '/' + execId + '.out';
  var errFile = OUTPUT_DIR + '/' + execId + '.err';


  return new Promise(function(resolve, reject) {
    var oldmask = process.umask(0);
    fs.writeFile(outFile, "", function() {
      process.umask(oldmask);
      fs.watchFile(outFile, {persistent:false}, function(curr, prev) {
        fs.unwatchFile(outFile, nullFn);
        fs.readFile(errFile, function(err, errOut) {
          var stderr = errOut ? errOut.toString() : '';
          fs.readFile(outFile, function(err, stdOut) {
            var stdout = stdOut ? stdOut.toString() : '';
            fs.unlink(outFile, nullFn);
            fs.unlink(errFile, nullFn);
            resolve({stdout: stdout, stderr: stderr});
          })
        })
      });
      fs.writeFile(inFile, cmd, nullFn);
    })
  })
}

CP.execCmdFromFile = function(fileName) {
  inFlight[fileName] = true;
  var inFile = INPUT_DIR + '/' + fileName;
  var outFile = OUTPUT_DIR + '/' + fileName + '.out';
  var errFile = OUTPUT_DIR + '/' + fileName + '.err';
  fs.readFile(inFile, function(err, stream) {
    fs.unlink(inFile, nullFn);
    if (err) {
      delete inFlight[fileName];
      return console.error(new Date().toISOString() + ' CP Error reading command to execute: ', err);
    }
    var cmd = stream.toString();
    console.log(new Date().toISOString() + ' CP executing: ' + cmd);
    exec(cmd, function(err1, stdout, stderr) {
      delete inFlight[fileName];
      stdout = stdout ? stdout.toString() : '';
      stderr = stderr ? stderr.toString() : '';
      if (err1) {
        stderr = err1.message;
        console.error(new Date().toISOString() + ' ERROR: ', JSON.stringify(err1));
      }
      var oldmask = process.umask(0);
      fs.writeFile(errFile, stderr, function(err) {
        if (err1) {
          console.error('Problem writing command .err file: ', err);
        }
        fs.writeFile(outFile, stdout, function(err1) {
          if (err1) {
            console.error('Problem writing command .out file: ', err1);
          }
          process.umask(oldmask);
        })
      })
    })
  })
}

// Start the command processor service
CP.start = function() {
  console.log(new Date().toISOString() + ' Starting command processor...');
  var oldmask = process.umask(0);
  return Promise.resolve()
    .then(function() {
      return mkdirp(INPUT_DIR, 0777);
    })
    .then(function() {
      return mkdirp(OUTPUT_DIR, 0777);
    })
    .then(function() {
      process.umask(oldmask);
      fs.watchFile(INPUT_DIR, {}, function(curr, prev) {
        fs.readdir(INPUT_DIR, function (err, dirFiles) {
          if (err) return;
          dirFiles.forEach(function (fileName) {
            if (inFlight[fileName]) {return}
            CP.execCmdFromFile(fileName)
          })
        })
      });
    })
}

// Start the command processor service
CP.stop = function() {
  console.log(new Date().toISOString() + ' Stopping command processor...');
  return Promise.resolve()
    .then(function() {
      fs.unwatchFile(INPUT_DIR);
    })
}
