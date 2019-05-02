Persistence
===========

This is a set of utilities for managing object persistence

Get a data model
----------------

var Hub = require('./persist').Hub;

Construct one
-------------

var hub = new Hub({id: hubId,...});  // Existing object
var hub = new Hub(hubId);            // By ID
var hub = Hub(hubId);                // Shortcut

CRUD it
-------

hub.load().then...
hub.save().then...
hub.delete().then...

Static methods
--------------

Hub.load(hubId).then... (resolved with a hub instance)
Hub.loadByHref(someLinkHref).then... (resolved with a hub instance)
Hub.loadIndexed('indexedFieldName', fieldValue).then... (if unique, then {}, otherwise []}
Hub.delete(hubId || href).then... (resolved or rejected)
Hub.all().then... (resolved w/all instances by id)

Manage links
------------

Links in the instance:

links: {
  auth_token: {href:'tokens/xxx-xxx-xx'},
  refresh_token: {href:'tokens/xxx-xxx-xxx', meta:{expires:"some-date"}},
  tunnels: [
    {name:"port80", href:'tunnels/yyyx-xx-xxx'},
    {name:"port8080", href:'tunnels/zzyx-xx-xxx'}
  ]
}

hub.addLink('auth_token', authToken) // Get link name from object
hub.addLink('tunnels', 'port80', port80Tunnel) // Specify the link name
hub.rmLink('tunnels', 'port80')
hub.rmLink('tunnels', port80Tunnel)
hub.rmLink('auth_token') // no name/object necessary if singleton

hub.loadLinked('auth_token').then (singleton link)
hub.loadLinked('tunnels').then (array of all tunnel links)
hub.loadLinked('tunnels', 'port80').then (singleton by name)
hub.loadLinked('tunnels/port80').then (singleton by name)

Link Keys
---------

Links are arrays, but if the link object has a name,
that name is jacked into the array.  Example:

hub.links.tunnels['port80'] = {name='port80', href='...'};
hub.links.tunnels.port8080 = {name='port8080', href='...'};

Errors
------

If promises reject, they're rejected with an HttpError object
from the require('httperrors') npm package.

See://github.com/One-com/node-httperrors for more information.

Example:

var hub = Hub(hubId).load()
  .then(function() {
   ...
  })
  .catch(function(e) {
    if (e.NotFound) {...}
    if (e.status === 404) {...}
    if (e.name === 'NotFound') {...}
    if (e.message === 'Some custom notfound message') {...}
  });

Misc
----

hub.getHref()
hub.loadByHref('some/href')