var Promise = require('bluebird');
var HttpError = require('httperrors')
var _ = require('lodash');
var extend = require('deep-extend');
var Express = require('express');
var config = require('config').get('iot-edge');
var Hub = require('./persist').Hub;
var User = require('./persist').User;
var fs = Promise.promisifyAll(require('fs'));
var Path = require('path');
var Request = Promise.promisify(require('request'));
var grafanaHost = null;

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

Dashboard.init = function() {
  return Promise.resolve()
    .then(function() {
      return Dashboard.initGrafanaHost()
    })
    .then(function() {
      return Dashboard.initDatasource()
    })
    .then(function() {
      return Dashboard.initNotificationChannel()
    })
}

Dashboard.initGrafanaHost = function() {
  return Hub.loadSingleton()
    .then(function(hub) {
      if (!hub.grafanaPW) {
        return Dashboard.setInitialGrafanaPW(hub);
      }
      return hub;
    })
    .then(function(hub) {
      var host = config.get('grafana.host');
      var port = config.get('grafana.port');
      grafanaHost = 'http://admin:' + hub.grafanaPW + '@' + host + ':' + port;
    })
}

Dashboard.setInitialGrafanaPW = function(hub) {
  var pw = {password: 'a' + Math.floor(Math.random() * 100000000000)};
  var host = config.get('grafana.host');
  var port = config.get('grafana.port');
  var uri = 'http://admin:admin@' + host + ':' + port + '/api/admin/users/1/password';
  var putConfig = {
    uri: uri,
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(pw)
  }
  return Request(putConfig)
    .catch(function(err) {
      throw new HttpError.ServiceUnavailable('Error initializing Grafana admin pw: ', err.message);
    })
    .then(function(rsp) {
      if (rsp.statusCode != 200) {
        throw new HttpError.ServiceUnavailable('Problem initializing Grafana admin pw status: ' + rsp.statusCode);
      }
      hub.grafanaPW = pw.password;
      return hub.save();
    })
}

Dashboard.initDatasource = function() {

  var getUrl = Dashboard.makeURI('/api/datasources');
  return Request(getUrl)
    .then(function(rsp) {
      if (!_.find(JSON.parse(rsp.body), {id: 1})) {
        throw new HttpError.NotFound('need to add ds');
      }
    })
    .catch(function(e) {
      console.log('> Dashboard: Adding Graphite datasource');
      datasource = {
        "name": "graphite",
        "type": "graphite",
        "url": "http://graphite/" + process.env.SITE_ID + '/graphite',
        "access": "proxy",
        "jsonData": {
          "graphiteVersion": "1.1",
          "keepCookies": []
        },
        "secureJsonFields": {},
        "secureJsonData": {},
        "isDefault": true
      }

      var postConfig = {
        uri: Dashboard.makeURI('/api/datasources'),
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(datasource)
      }

      return Request(postConfig)
        .catch(function(err) {
          throw new HttpError.ServiceUnavailable('Error connecting to Grafana: ', err);
        })
    })

}

Dashboard.initNotificationChannel = function() {

  // Initialize the default grafana data source
  var channel = {
    "name": "Microclimates Webhook",
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
      'Content-Type': 'application/json',
      'X-Grafana-Org-Id': '1'
    }
  }
  var postConfig = {
    uri: Dashboard.makeURI('/api/alert-notifications'),
    method: 'POST',
    headers: {
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
