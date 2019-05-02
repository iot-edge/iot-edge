var Promise = require('bluebird');
var PATH = require('path');
var fs = Promise.promisifyAll(require('fs'));
var mime = require('mime');
var Router = require('express-promise-router')
var _ = require('lodash')
var AWS = require('aws-sdk');
var s3 = new AWS.S3({apiVersion: '2006-03-01'});
var S3_BUCKET = 'private.microclimates.com';
var cdn = module.exports = Router()
var ServicePlan = require('../persist').ServicePlan;
var servicePlan = null;

cdn.fetchServicePlan = async function() {
  return servicePlan = (servicePlan || await ServicePlan.loadSingleton());
}

// Upload a file or files
cdn.upload = function(request, response) {
  var paramList = ['*path','*dir','*file','*s3UploadParams', '*remove'];
  var params = request.getParams({query:paramList, body:paramList});
  var path = params.path || '';
  if (path.substr(0,1) == '/') {path = path.substr(1)}
  var dir = params.dir || '';
  var file = params.file || '';
  var s3UploadParams = params.s3UploadParams ? params.s3UploadParams : {};
  s3UploadParams = _.isString(s3UploadParams) ? JSON.parse(s3UploadParams) : s3UploadParams;
  var remove = params.remove;
  if (!dir && !file) {return response.status(400).send({status:'error',msg:'Must provide dir or file'})};
  if (dir && file) {return response.status(400).send({status:'error',msg:'Only one of dir or file'})};

  return cdn.fetchServicePlan()
    .then(function() {
      if (dir) {
        return cdn.uploadDir({}, path, dir, s3UploadParams, remove)
          .then(function() {
            response.send('Directory uploaded\n');
          })
          .catch(function(err) {
            if (err.code == 'ENOENT') {
              response.status(404).send('Directory not found\n');
              return;
            }
            console.error(err);
            response.status(500).send(err);
          })
      }
      return cdn.uploadFile(path, file, s3UploadParams, remove)
        .then(function(uri) {
          response.send({uri:uri});
        })
        .catch(function(err) {
          if (err.code == 'ENOENT') {
            response.status(404).send('File not found\n');
            return;
          }
          console.error(err);
          response.status(500).send(err);
        })
    })
}

// Traverse a directory, uploading all files in it and below
cdn.uploadDir = function(traversed, path, dir, s3UploadParams, remove) {
  if (traversed[dir]) return;
  traversed[dir] = true;
  var fullDir = PATH.join('/mnt/edge/fs', dir);
  return fs.readdirAsync(fullDir)
    .then(function(files) {
      // Remove directory if asked to remove and no files in this directory
      if (files.length == 0 && remove) {
        return fs.rmdirAsync(fullDir);
      }
      var chain = Promise.resolve();

      // Remove directory if asked to remove and no files in this directory
      files.forEach(function(file) {
        var filePath = PATH.join(fullDir, file);
        var filePathRelative = PATH.join(dir, file);
        chain = chain.then(function() {return fs.statAsync(filePath)
          .then(function(stats) {
            if (stats.isDirectory()) {
              var cdnPath = PATH.join(path, file);
              return cdn.uploadDir(traversed, cdnPath, filePathRelative, s3UploadParams, remove);
            }
            else if (stats.isFile()) {
              return cdn.uploadFile(path, filePathRelative, s3UploadParams, remove);
            }
          })
        });
      });

      return chain;
    })
}

// Upload a file to a cdn path
cdn.uploadFile = function(path, file, s3UploadParams, remove) {

  s3UploadParams = s3UploadParams || {};
  return new Promise(function (resolve, reject) {
    var filePath = PATH.join('/mnt/edge/fs', file);
    var fileName = PATH.basename(file);
    var cdnPath = PATH.join(process.env.IAM_NAME, path, fileName);
    var cdnUri = PATH.join('https://s3.amazonaws.com/private.microclimates.com', cdnPath);

    var fs = require('fs');
    var fileStream = fs.createReadStream(filePath);

    var mimetype = mime.lookup(filePath);
    var charset = mime.charsets.lookup(filePath);
    var contentType = mimetype + (charset ? '; charset=' + charset : '');

    // Add cam image retention tag
    if (filePath.indexOf('/mnt/edge/fs/mc-cam/') == 0) {
      // fileName: '01_57_00.000Z-photo.jpg'
      var retention = servicePlan.camImageRetention_minute;
      if (fileName.substr(3,2) == '00') {
        retention = servicePlan.camImageRetention_hour;
      }
      s3UploadParams.Tagging = (s3UploadParams.Tagging ? "&" : "") + "retention=" + retention;
    }
    else if (path.indexOf('/tiles/') >= 0) {
      s3UploadParams.Tagging = (s3UploadParams.Tagging ? "&" : "") + "retention=1_month_delete";
    }

    var uploadParams = _.extend(
      {Bucket: S3_BUCKET, Key: cdnPath, ContentType: contentType, Body: fileStream},
      s3UploadParams
    );
    s3.upload (uploadParams, function (err, data) {
      if (err) {
        if (err.code != 'ENOENT') {
          console.error("Error", err);
        }
        return reject(err);
      }
      if (remove) {
        fs.unlink(filePath, function(err) {
          if (err) {
            console.error('File remove error: ' + filePath);
          }
          resolve(cdnUri);
        })
      } 
      else {
        resolve(cdnUri);
      }
    });
  });
}

// Routing table
cdn.post('/cdn', cdn.upload);
