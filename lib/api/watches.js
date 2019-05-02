var Router = require('express-promise-router')
var Watch = require('../persist').Watch;
var AuthC = require('../authenticate');
var AuthZ = require('../authorize');
var _ = require('lodash')

var watches = module.exports = Router()

// Returns all watches
// Or a list of watches by id: ?ids=id,id,id...
watches.searchWatches = function(request, response) {
  var ids = request.getParams({query:['*ids']}).ids
  if (ids) {
    return watches.getMany(ids.split(','))
      .then(function(watches) {
        response.send(_.toArray(watches)); // keep requested ordering
      });
  }
  return Watch.all()
    .then(function(watches) {
      var sorted = _.sortBy(watches,'name');
      response.send(sorted);
    });
}

// Return many watches (by id) into an array
watches.getMany = function(ids) {
  return Promise.resolve()
    .then(function() {
      var promises = [];
      ids.forEach(function(watchId) {
        promises.push(Watch.load(watchId))
      })
      return Promise.all(promises);
    })
}


// Routing table
watches.get('/watches', AuthC.session, AuthZ.role('admin'), watches.searchWatches)
/*
watches.get('/watches/:watchId', AuthC.session, AuthZ.role('admin'), watches.getWatch)
watches.put('/watches/:watchId', AuthC.session, AuthZ.role('admin'), watches.putWatch)
watches.post('/watches', AuthC.session, AuthZ.role('admin'), watches.postWatch)
watches['delete']('/watches/:watchIds', AuthC.session, AuthZ.role('admin'), watches.deleteWatches)
*/
