/**
 * Promise based interface to a resource store backed by the local FS
 *
 * - The directory structure is exactly 2 levels: resourceType/id
 * - Files are persisted as JSON strings
 */

var Promise = require('bluebird');
var fs = Promise.promisifyAll(require('fs'));
var baseDir = require('config').get('iot-edge.persist.file.dir');
var mkdirp = Promise.promisify(require('mkdirp'));
var UUID = require('uuid');
var makePath = function(resourceType, id) {
  var path = baseDir + '/' + resourceType;
  if (id) {
    id = '' + id;
    id = id.replace(/\//g,'_');
    path += '/' + id;
  }
  return path;
}
var HttpError = require('httperrors');
var _ = require('lodash');

// Static methods exported
var File = module.exports = {};

/**
 * Get a resource or all resources of a type
 *
 * If ID is passed, the response is the resource as an object
 * If no ID is passed, an object keyed by resource ID is returned
 *
 * @method get
 * @param resourceType {String} Resource type name
 * @param id {String} Id of that resource (or blank for all resources of that type)
 * @return promise {Promise} Resolved with a filled k/v object at the path
 */
File.get = function(resourceType, id) {
  if (!id) {
    throw new HttpError.NotFound('No ID provided for ' + resourceType);
  }
  var path = makePath(resourceType, id);
  return fs.readFileAsync(path, 'utf8')
    .then(function(data) {
      return JSON.parse(data.toString());
    })
    .catch(function(err) {
      if (err.code === 'ENOENT') {
        throw new HttpError.NotFound('No key found for ' + resourceType + '/' + id);
      }
      throw new HttpError[500]('Failed GET for ' + resourceType + '/' + id + ' : ' + err.code);
    });
}

/**
 * Multi-get
 */
File.getAll = function(resourceType) {
  var path = makePath(resourceType);
  return fs.readdirAsync(path)
    .then(function(fileNames) {
      var promises = [];
      fileNames.forEach(function(fileName){
        promises.push(File.get(resourceType, fileName));
      });
      return Promise.all(promises);
    })
    .then(function(files) {
      var resources = {};
      files.forEach(function(file) {
        resources[file.id] = file;
      })
      return resources;
    })
    .catch(function(err) {
      // No resources yet
      if (err.code === 'ENOENT') {
        return {};
      }
      throw new HttpError[500]('Failed GET for ' + resourceType + ' : ' + err.code);
    })
}

/**
 * Save a resource
 *
 * @param resourceType {String} Resource type name
 * @param id {String} Id of the resource to save (null to assign an ID)
 * @param resource {Object} Resource to save
 * @return promise {Promise} Resolved with ID when saved or rejected on error
 */
File.put = function(resourceType, id, resource) {

  // Generate an id if necessary
  if (!id) {
    id = resource.id;
    if (!id) {
      id = UUID.v4();
    }
  }

  // No slashes
  id = id.replace(/\//g,'_');

  // Crate an object to save w/id and type at the top
  var saveObj = {
    id: id,
    type: resourceType
  };
  _.extend(saveObj, resource);
  saveObj.id = id;
  saveObj.type = resourceType;

  // Save
  var dir = makePath(resourceType);
  var path = makePath(resourceType, id);
  return mkdirp(dir)
    .then(function(){
      return fs.writeFileAsync(path, JSON.stringify(resource,null,2));
    })
    .then(function(){
      return id;
    })
    .catch(function(err) {
      throw new HttpError[500]('Failed PUT for ' + resourceType + '/' + id + ' : ' + err.code);
    });
}

/**
 * Delete a resource
 *
 * @param resourceType {String} Resource type name
 * @param id {String} Id of that resource to save
 * @return promise {Promise} Resolved when saved or rejected on error
 */
File.delete = function(resourceType, id) {
  var path = makePath(resourceType, id);
  return fs.unlinkAsync(path)
    .catch(function(err) {
      // Ok if not there to begin with
      if (err.code === 'ENOENT') {
        return;
      }
      throw new HttpError[500]('Failed DELETE for ' + resourceType + '/' + id + ' : ' + err.code);
    })
}
