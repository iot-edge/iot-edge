var Promise = require('bluebird');
var HttpError = require('httperrors')
var _ = require('lodash');
var Express = require('express');
var config = require('config').get('iot-edge');
var Hub = require('./persist').Hub;
var Request = Promise.promisify(require('request'));
var grafanaHost = 'http://' + config.get('grafana.host') + ':' + config.get('grafana.port');

/**
 * Dashboard - Interface with DB type grafana dashboards
 */
var Dashboard = module.exports = function() {
  var app = Express();

  var errResponse = function(err, response) {
    response.statusCode = 500;
    console.error("Dashboard error:", err.stack);
    response.send({error:err.message});
  };

  app.get('/dashboard/:slug', function(request, response) {
    var slug = request.params.slug;
    Dashboard.load(slug).then(function(dashboard) {
      var dashStr = JSON.stringify(dashboard,null,2);
      response.send(dashStr + '\n');
    }).catch(function(e) {errResponse(e, response)}).done();
  });

  app.get('/dashboards', function(request, response) {
    Dashboard.list().then(function(dashboards) {
      var dashStr = JSON.stringify(dashboards,null,2);
      response.send(dashStr + '\n');
    }).catch(function(e) {errResponse(e, response)}).done();
  });

  return app;
};

/**
 * Load the dashboard
 *
 * @method load
 * @param slug Dashboard slug
 * @return promise {Promise} Resolved with settings for the specified dashboard
 */
Dashboard.load = function(slug) {
  return Dashboard.apiGet('/api/dashboards/db/' + slug).then(function(response){
    if (response.statusCode == 404) {
      throw new HttpError.NotFound('Dashboard not found: ' + slug);
    }
    var body = JSON.parse(response.body);
    if (!body.dashboard) {
      throw new HttpError.BadRequest('Bad response from Dashboard.load for dash: ' + slug, body);
    }
    return body;
  });
};

Dashboard.fetchUuidFromSlug = async function(slug) {
  var dash = await Dashboard.load(slug);
  return dash.dashboard.uid;
}

/**
 * Load many dashboards into an array
 *
 * @method loadMany
 * @param dashSlugs[] {String} Dashboard slugs
 * @return promise {Promise} Resolved with an array of dashboards
 */
Dashboard.loadMany = function(dashSlugs) {
  Promise.resolve()
    .then(function() {
      var promises = [];
      dashSlugs.forEach(function(slug){
        promises.push(Dashboard.load(slug));
      });
      return Promise.all(promises);
    });
};

/**
 * Save a dashboard
 *
 * @method save
 * @param dashboard {Dashboard} Dashboard to save. With ID = update, without = insert
 * @return promise {Promise} Resolved with settings for the specified dashboard
 */
Dashboard.save = function(dashboard) {
  var config = {
    uri: Dashboard.makeURI('/api/dashboards/db'),
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(dashboard)
  }
  return Request(config)
    .then(function(response){
      var body = response.body;
      return JSON.parse(body);
    });
};

/**
 * Get a list of all dashboards
 *
 * This is resolved with a summary for each dashboard. 
 *
 * @method list
 * @param tags=null (String or Array) Tag name or list of tag name
 * @return promise {Promise} Resolved with dashboards
 */
Dashboard.list = function(tags) {
  var url = '/api/search';
  if (tags) {
    url += '?starred=false';
    tags = Array.isArray(tags) ? tags : [tags];
    _.each(tags, function(tag) {
      url += '&tag=' + encodeURIComponent(tag)
    })
  }
  return Dashboard.apiGet(url).then(function(response){
    var body = response.body;
    return JSON.parse(body);
  });
};

/**
 * Remove a DB dashboard
 *
 * @method remove
 * @param slug {String} The dashboard slug
 * @return promise {Promise} Resolved or rejected
 */
Dashboard.remove = function(slug) {
  var config = {
    uri: Dashboard.makeURI('/api/dashboards/db/' + slug),
    method: 'DELETE'
  }
  return Request(config)
    .then(function(response){
      var body = response.body;
      return JSON.parse(body);
    });
};

// This replaces ES6 style ${device.min} template variables in a dashboard object
Dashboard.replaceTemplate = function(dashboard, dataModel) {

  var dash = JSON.stringify(dashboard);

  // Remove quotes for templatized non-strings.
  // Turns this:
  //   "min": "!<${device.config.humidGaugeLo}>!",
  // Into this:
  //   "min": ${device.config.humidGaugeLo},
  // In preparation for this:
  //  "min": 42,
  dash = dash.replace(/("!<)|(>!")/g, '');

  // ES6 template style ${device.id}
  try {
    var compiled = _.template(dash);
    dash = compiled(dataModel);
  }
  catch (e) {
    console.error('Template replacement failed for dashboard:', JSON.stringify(dashboard,null,2));
    console.error('Data model:', JSON.stringify(dataModel,null,2));
    throw e;
  }

  var parsed;
  try {
    parsed = JSON.parse(dash);
  }
  catch (e) {
    console.error('Parse failed for dashboard:', dash);
    console.error('Data model:', dataModel);
    throw e;
  }
  return parsed;
}

Dashboard.setDefault = function (slug) {
  return Dashboard.load(slug)
    .then(function(dash) {
      var body = {
          theme: "",
          timezone: "",
          homeDashboardId: dash.dashboard.id
      };
      var config = {
        uri: Dashboard.makeURI('/api/org/preferences'),
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(body)
      }
      return Request(config);
    })
}

Dashboard.makeURI = function(path) {
  return grafanaHost + path;
}

Dashboard.apiGet = function(path) {
  var uri = Dashboard.makeURI(path);
  return Request(uri);
}

Dashboard.init = async function() {
  let hub = await Hub.loadSingleton();
  if (!hub.grafanaAPIKey) {
    await Dashboard.setGrafanaAPIKey(hub);
  }
  await Dashboard.initNotificationChannel(hub);
}

Dashboard.setGrafanaAPIKey = async function(hub) {
  let host = config.get('grafana.host');
  let port = config.get('grafana.port');
  let uri = 'http://admin:admin@' + host + ':' + port + '/api/auth/keys';
  let postConfig = {
    uri: uri,
    method: 'POST',
    headers: {
      'Accept': 'application/json',
      'Content-Type': 'application/json',
      'X-Grafana-Org-Id': '1'
    },
    body: '{"name": "Edge Server Admin (don\'t delete)", "role": "Admin"}'
  }
  try {
    console.log('-> Creating Grafana API Key');
    let rsp = await Request(postConfig);
    var body = JSON.parse(rsp.body);
    hub.grafanaAPIKey = body.key;
  }
  catch (err) {
    throw new HttpError.ServiceUnavailable('Error initializing Grafana API Key: ', err.message);
  }
  await hub.save();
}

Dashboard.initNotificationChannel = function(hub) {

  // Initialize the default grafana data source
  var channel = {
    "name": "Edge Server Webhook",
    "type": "webhook",
    "settings": {
      "uploadImage": true,
      "url": "http://mchub:9002/alert",
      "httpMethod": "POST"
    },
    "isDefault": true
  }
  var getConfig = {
    uri: Dashboard.makeURI('/api/alert-notifications'),
    headers: {
      'Authorization': 'Bearer ' + hub.grafanaAPIKey,
      'Content-Type': 'application/json',
      'X-Grafana-Org-Id': '1'
    }
  }
  var postConfig = {
    uri: Dashboard.makeURI('/api/alert-notifications'),
    method: 'POST',
    headers: {
      'Authorization': 'Bearer ' + hub.grafanaAPIKey,
      'Content-Type': 'application/json',
      'X-Grafana-Org-Id': '1'
    },
    body: JSON.stringify(channel)
  }

  // See if the notification channel exists
  return Request(getConfig)
    .then(function(rsp) {
      if (rsp.statusCode != 200) {
        throw new HttpError.InternalServerError('Grafana API problem: ' + JSON.stringify(getConfig));
      }
      var channels = JSON.parse(rsp.body);
      var mcChannel = _.find(channels, function(channel) {
        return channel.name == 'Microclimates Webhook' && channel.type == 'webhook' && channel.isDefault;
      })
      if (mcChannel) {
        return;
      }
      console.log('-> Creating Grafana Notification Channel');
      return Request(postConfig);
    })

}
