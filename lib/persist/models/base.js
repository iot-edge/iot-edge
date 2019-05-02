/**
 * Base class from which all data models derive
 *
 * This contains the basic instance operations including
 * construction, link management, and CRUD operations.
 *
 */
var Promise = require('bluebird');
var UUID = require('uuid');
var config = require('config').get('iot-edge.persist');
var store = require('../lib/' + config.get('store'));
var EventEmitter = require('events');
var _ = require('lodash');
var HttpError = require('httperrors');
var META_INDEXED_FIELDS = '__indexed_fields'

/**
 * Constructor
 *
 * @param instance {Object} The raw JS object to instantiate this from
 */
var Base = module.exports = function(modelName, instance) {

  var t = this;
  var model = Base.models[modelName];

  // If instance is a key, use it as an ID
  if (_.isString(instance)) {
    instance = {id:instance}
  }

  // Pull defaults and order in first, then the instance
  _.extend(t, _.cloneDeep(model), _.cloneDeep(instance))
  t.addLinkNames()
  t.rememberIndexedFields()
  t.afterLoad()

  // Make sure it has an ID
  t.id = t.id || UUID.v4();

}
require('util').inherits(Base, EventEmitter);
var proto = Base.prototype;

// Expose these statically for subclass registration
var models = Base.models = {};    // Models by name
var classes = Base.classes = {};  // Class constructors by name

/**
 * Load the current value from the data store
 *
 * @method load
 * @param (none)
 * @return promise {Promise} Resolved with this object or rejected with error
 */
proto.load = function() {
  var t = this;
  return store.get(t.type, t.id)
    .then(function(raw) {
      _.extend(t, raw);
      t.addLinkNames();
      t.rememberIndexedFields()
      t.afterLoad()
      return t;
    });
}

// Triggers to be overloaded in sub classes
proto.afterLoad = function(){};
proto.beforeSave = function(){};

/**
 * Persist the instance
 *
 * @method save
 * @param (none)
 * @return promise {Promise} Resolved with this or rejected with error
 */
proto.save = function() {
  var t = this;
  var indexedFields = void 0
  t.beforeSave();
  return t.updateIndices()
    .then(function() {
      if (t.meta[META_INDEXED_FIELDS]) {
        indexedFields = t.meta[META_INDEXED_FIELDS]
        delete t.meta[META_INDEXED_FIELDS]
      }
      return store.put(t.type, t.id, t)
    })
    .then(function() {
      if (indexedFields) {
        t.meta[META_INDEXED_FIELDS] = indexedFields
      }
      return t;
    });
}

/**
 * Delete this instance
 *
 * @method delete
 * @param (none)
 * @return promise {Promise} Resolved with this or rejected with error
 */
proto.delete = function() {
  var t = this;
  var clazz = Base.classes[t.type];

  // No indexes
  if (!clazz.indexes) {
    return store.delete(t.type, t.id)
      .then(function(){
        return t;
      })
  }

  // Delete indexes
  var indexPromises = [];
  for (var fieldName in clazz.indexes) {
    var indexClassName = clazz.indexes[fieldName]
    var indexClass =  Base.classes[indexClassName]
    var value = indexClass.normalize(t[fieldName])
    if (value) {
      indexPromises.push(store.delete(indexClassName, value));
    }
  }
  return Promise.all(indexPromises)
    .then(function(){
      return store.delete(t.type, t.id);
    })
    .then(function(){
      return t;
    })
}

/**
 * Add name based access to plural links (dictionaries)
 *
 * @method addLinkNames
 */
proto.addLinkNames = function() {
  var t = this;
  _.forOwn(t.links, function(linkRel) {
    if (Array.isArray(linkRel)) {
      linkRel.forEach(function(link) {
        if (link.name) {
          linkRel[link.name] = link;
        }
      });
    }
  })
}

/**
 * Remember the indexed field values on load
 *
 * @method rememberIndexedFields
 */
proto.rememberIndexedFields = function() {
  var t = this
  var clazz = Base.classes[t.type]
  if (clazz.indexes) {
    var fieldsMeta = t.meta[META_INDEXED_FIELDS] = {}
    for (var fieldName in clazz.indexes) {
      fieldsMeta[fieldName] = t[fieldName]
    }
  }
}

/**
 * Update indexes before save (if necessary)
 *
 * @method updateIndices
 */
proto.updateIndices = function() {
  var t = this
  var clazz = Base.classes[t.type]
  var fieldsMeta = t.meta[META_INDEXED_FIELDS]
  if (!clazz.indexes) {
    return Promise.resolve()
  }

  // Prepare a list of indices to update based on changed data
  var indicesToUpdate = []  // [{indexClassNam, indexClass, beforeValue, afterValue},...]
  for (var fieldName in clazz.indexes) {
    var indexClassName = clazz.indexes[fieldName]
    var indexClass =  Base.classes[indexClassName]
    var indexModel = Base.models[indexClassName]
    var isUnique = !Array.isArray(indexModel[t.type])
    var beforeValue = indexClass.normalize(fieldsMeta[fieldName])
    var afterValue = indexClass.normalize(t[fieldName])
    if (beforeValue !== afterValue) {
      indicesToUpdate.push({
          indexClassName: indexClassName,
          indexClass: indexClass,
          indexModel: indexModel,
          isUnique: isUnique,
          fieldName: fieldName,
          beforeValue: beforeValue,
          afterValue: afterValue,
      })
    }
  }

  return Promise.resolve()
    .then(function() {
      // Check unique indexes before continuing
      var checkUniquePromises = []
      indicesToUpdate.forEach(function(idxInfo) {
        if (idxInfo.isUnique) {
          checkUniquePromises.push(t.checkUniqueIndex(idxInfo))
        }
      })
      return Promise.all(checkUniquePromises)
    })
    .then(function() {
      var updateIndexPromises = []
      indicesToUpdate.forEach(function(idxInfo) {
        updateIndexPromises.push(t.updateIndex(idxInfo))
      })
      return Promise.all(updateIndexPromises)
    })
}

/**
 * Check the index to make sure the afterValue isn't present
 *
 * @method checkUniqueIndex
 * @param idxInfo {Object} - The index info object
 * @return {Promise} Resolved if unique, rejected with 409-Conflict(fieldName) if the indexed value exists
 */
proto.checkUniqueIndex = function(idxInfo) {
  var t = this;
  return idxInfo.indexClass.load(idxInfo.afterValue)
    .catch(function(err) {
      if (!err.NotFound) { throw err }
    })
    .then(function(idx) {
      if (idx) { throw HttpError.Conflict(idxInfo.fieldName) }
    })
}

/**
 * Update an index by deleting the beforeValue index and adding the afterValue index
 *
 * @method updateIndex
 * @param idxInfo {Object} - The index info object
 * @return {Promise} Resolved if updated, rejected if problems
 */
proto.updateIndex = function(idxInfo) {
  var t = this;
  return Promise.resolve()
    .then(function() {
      if (idxInfo.beforeValue.length) {
        //TODO: Implement non-unique indexes as 1 index record with link rel array
        //TODO: Allow value to be an array for multiple index entries
        return idxInfo.indexClass.delete(idxInfo.beforeValue)
      }
    })
    .catch(function(err) {
      if(!err.NotFound) {throw err}
    })
    .then(function() {
      if (idxInfo.afterValue.length) {
        //TODO: Implement non-unique indexes
        //TODO: Allow value to be an array for multiple index entries
        var idx = new idxInfo.indexClass(idxInfo.afterValue)
        idx.addLink(t.type, t)
        return idx.save()
      }
    })
    .then(function() {
      // Update meta in case the instance lives beyond the save
      t.meta[META_INDEXED_FIELDS][idxInfo.fieldName] = idxInfo.afterValue
    })

}

/**
 * Load all linked objects of the specified rel
 *
 * If the rel is singleton, this resolves with a single object.
 *
 * If the rel is an array, this resolves with a dictionary - an array
 * of objects, keyed by link name.
 *
 * @method loadLinked
 * @param rel {String} Relationship type
 * @param [name] {String} Relationship name
 * @return promise {Promise} Resolved with one or an array of related objects
 */
proto.loadLinked = function(rel, name) {
  var t = this;
  return Promise.resolve()
    .then(function() {
      if (rel.indexOf('/') > 0) {
        var parts = rel.split('/')
        rel = parts[0]
        name = parts[1]
      }
      var linksRel = t.getLinkRel(rel);
      var container = name ? linksRel[name] : linksRel;
      if (!container) {
        throw new HttpError.NotFound('No rel ' + rel + '/' + name + ' for type ' + t.type + ' in object ' + t.id);
      }

      // Singleton
      if (!Array.isArray(container)) {
        if (!container.href) {
          throw new HttpError.NotFound('No link for rel ' + rel + ' in object ' + t.id);
        }
        return t.loadByHref(container.href);
      };

      // Plural
      var promises = [];
      var related = [];
      _.forEach(container, function(link) {
        var index = promises.length;
        promises.push(t.loadByHref(link.href)
          .then(function(obj) {
            // link joy
            related[index] = obj;
            // Jack the name into the array (dictionary)
            if (link.name) {
              related[link.name] = obj;
            }
          })
          .catch(function(e) {
            // link grief
            related[index] = null;
          })
        );
      });

      return Promise.all(promises)
        .then(function(){
          return related;
        });
    });
}

/**
 * Get the href address of this object
 *
 * @method getHref
 * @return href {String} The href address of this object
 */
proto.getHref = function() {
  var t = this;
  return t.type + '/' + t.id;
}

/**
 * Load an object by href
 *
 * @method loadByHref
 * @param href {String} Href to the object in the form of type/id
 * @return promise {Promise} Resolved with the object, or rejected 
 */
proto.loadByHref = function(href) {
  var t = this;

  // Get an object of that type
  var parts = href.split('/');
  var type = parts[0];
  var id = parts[1];
  if (!type || !id || !Base.classes[type]) {
    throw new HttpError.BadRequest('Cannot load HREF: ' + href);
  }
  var obj = new Base.classes[type]({id:id});
  return obj.load()
}

/**
 * Add a link to another object
 *
 * The link with the specified rel must exist in this object
 *
 * @method addLink
 * @param rel {String} Relationship type (rel)
 * @param [name] {String} Name this object calls this link
 * @param object {ModelInstance} Instance to relate
 * @return link {Link} The link object
 */
proto.addLink = function(rel, name, object) {
  var t = this;
  if (arguments.length === 2) {
    object = name
    name = object.name
  }
  var container = t.getLinkRel(rel);
  if (!container) {
    throw new HttpError.BadRequest('No rel ' + rel + ' for type ' + t.type + ' in object ' + t.id);
  }

  // Build the link object
  var name = name || object.name;
  var linkObj = {
      name: name,
      href: object.getHref()
  };
  if (!name) {
      delete linkObj.name;
  }

  // Plural or singleton
  if (Array.isArray(container)) {
    // Dup hrefs are ok, but Require unique names
    if (name) {
      t.rmLink(rel, name);
    }
    container.push(linkObj);
    if (name) {
      container[name] = linkObj;
    }
  }
  else {
    t.links[rel] = linkObj;
  }
  return linkObj;
}

/**
 * Remove a link to another object
 *
 * If the rel is a singleton, it erases the link for that rel.
 * If the rel is an array, it finds the link based on the name
 * passed in, or by the href type/id made by the passed-in object.
 *
 * @method rmLink
 * @param rel {String} Relationship type (rel)
 * @param name {String} Name this object calls this link (optional if singleton or object present)
 * @param object {ModelInstance} Instance to delete from links (optional if singleton or name is present)
 */
proto.rmLink = function(rel, name, object) {
  var t = this;
  if (arguments.length === 2 && _.isObject(name)) {
    object = name
    name = object.name
  }
  var container = t.getLinkRel(rel);

  // Singleton
  if (!Array.isArray(container)) {
    t.links[rel] = {};
    return;
  }

  // Find and delete if plural
  var href = object ? object.getHref() : null;
  var idx = _.findIndex(container, function(item) {
    return (name === item.name || href === item.href)
  })
  if (idx >= 0) {
    container.splice(idx, 1);
  }

  // Remove a jacked-in name if present
  if (name) {
    delete container[name];
  }
}

// Gets a link/rel - adds if the model has it but not the object
proto.getLinkRel = function(rel) {
  var t = this;
  if (t.links[rel]) {return t.links[rel]}
  var model = Base.models[t.type];
  if (!model) {
    throw new HttpError.NotFound('No data model found for object:' + t.id);
  }
  var modelLinks = model.links || {};
  if (!modelLinks[rel]) {
    throw new HttpError.NotFound('No link type ' + rel + ' for object' + t.id);
  }

  if (Array.isArray(modelLinks[rel])) {
    t.links[rel] = [];
  }
  else {
    t.links[rel] = {};
  }
  return t.links[rel];
}

/*******
 * Static Methods
 *******/

/**
 * Load one instance of a specified type
 *
 * Normally it's run like Hub.load(hubId).then(...
 *
 * @static
 * @method load
 * @param modelName {String} The model type
 * @param args {Arguments} Arg0=instanceId
 * @return promise {Promise} Resolved with the correctly typed instance
 */
Base.load = function(modelName, args) {

  // This gets an instance
  return store.get(modelName, args[0])

    // Convert to a model instance
    .then(function(node) {
      var clazz = Base.classes[modelName];
      return new clazz(node)
    });
}

Base.loadByHref = function(modelName, args) {
  return proto.loadByHref(args[0])
}

/**
 * Load an instance from an index
 *
 * @static
 * @method loadIndexed
 * @param modelName {String} The model type
 * @param args {Arguments} Arg0=indexedFieldName, Arg1=value
 * @return promise {Promise} Resolved with the correctly typed instance
 */
Base.loadIndexed = function(modelName, args) {
  return Promise.resolve()
    .then(function() {
      var indexedFieldName = args[0]
      var value = args[1]
      var indexClassName = Base.classes[modelName].indexes[indexedFieldName]
      if (!indexClassName) {
        throw new HttpError.InternalServerError('No index for field ' + indexedFieldName + ' in model ' + modelName)
      }
      var indexClass =  Base.classes[indexClassName]
      return Base.load(indexClassName, [indexClass.normalize(value)])
        .then(function(index) {
          return index.loadLinked(modelName)
        })
    });
}

/**
 * Delete the specified instance
 *
 * Normally it's run like Hub.delete(hubId).then(...
 *
 * @static
 * @method delete
 * @param modelName {String} The model type
 * @param args {Arguments} Arg0=instanceId
 * @return promise {Promise} Resolved with deleted node or rejected with an error
 */
Base.delete = function(modelName, args) {
  var id = args[0]
  if (id.indexOf('/') > 0) {
    parts = id.split('/')
    modelName = parts[0]
    id = parts[1]
  }
  return Base.load(modelName, [id])
    .then(function(inst) {
      return inst.delete();
    })
}

/**
 * Load all instances of a specified model
 *
 * This is exported statically on all models
 *
 * @static
 * @method all
 * @param modelName {String} Get all instances of this model
 * @return promise {Promise} Resolved with a hash of instances by ID
 */
Base.all = function(modelName, args) {

  // This returns a hash of instances by ID
  return store.getAll(modelName)

    // Convert to model instances
    .then(function(nodes) {
      var clazz = Base.classes[modelName];
      _.forOwn(nodes, function(node) {
        nodes[node.id] = new clazz(node);
      })
      return nodes;
    });
}
