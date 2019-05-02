var _ = require('lodash')
var uuid = require('uuid')
var onHeaders = require('on-headers');
var HttpError = require('httperrors');
var OOPS_PAGE = 'oops'
var CLEAR_COOKIE = '; expires=Thu, 01 Jan 1970 00:00:00 UTC; Path=/;'
var validationResult = require('express-validator/check').validationResult;
var matchedData = require('express-validator/filter').matchedData;

/**
 * Common middleware and express support
 */

// Exporting static middleware methods
const app = module.exports = {}

/**
 * Make a request ID available
 */
app.addDebugLogging = function() {
  return function(request, response, next) {
    if (request.get('x-debug-logging') || request.query.DebugLogging) {
      var inboundReport = {
        'x-debug-logging': 'inbound',
        method: request.method,
        url: request.url,
        headers: request.headers,
        body: request.body
      }
      console.error(JSON.stringify(inboundReport,null,2));
      var oldSend = response.send
      response.send = function(body) {
        var outboundReport = {
          'x-debug-logging': 'outbound',
          method: request.method,
          url: request.url,
          status: response.statusCode,
          headers: {},
          body: body
        }
        var headerNames = response.getHeaderNames();
        headerNames.forEach(function(name) {
          outboundReport.headers[name] = response.getHeader(name);
        })
        console.error(JSON.stringify(outboundReport,null,2));
        response.send = oldSend
        oldSend.apply(this, arguments)
      }
    }
    next();
  }
}

/**
 * Make a request ID available
 */
app.addRequestID = function() {
  return function(request, response, next) {
    var incomingID = request.get('X-Request-ID');
    request.id = incomingID ? incomingID : uuid.v4()
    response.set('X-Request-ID', request.id)
    next()
  }
}

/**
 * Validate input. This accepts an array of checks, validates
 * those checks against request.body, and replaces request.body
 * with only those items that have been validated.
 *
 * See:
 * https://github.com/ctavan/express-validator
 */
app.validate = function(checks) {
  var middleware = checks.slice(0);
  middleware.push(function(request, response, next) {
    const errors = validationResult(request);
    if (!errors.isEmpty()) {
      throw new HttpError.BadRequest(JSON.stringify(errors.mapped()));
    }
    // matchedData returns only the subset of data validated by the middleware
    request.body = matchedData(request);
    next()
  });
  return middleware;
}

/**
 * Replace the x-powered-by: Express with something else, or remove it
 *
 * This removes any header added on the way down, and allows the most specific
 * header on the way back to win.
 */
app.addPoweredBy = function(poweredBy) {
  return function(request, response, next) {
    // Remove any headers set on the way down
    response.removeHeader('X-Powered-By');
    // Add headers on the way out, let the deepest one win
    onHeaders(response, function() {
      if (!response.get('X-Powered-By')) {
        if (poweredBy) {
          response.set('X-Powered-By', poweredBy)
        }
        else {
          response.removeHeader('X-Powered-By')
        }
      }
    });
    next();
  }
}

/**
 * Set (or clear) the access-control-allow-origin header
 */
app.addCors = function(allowOrigin, allowMethods, allowHeaders) {
  var ALLOW = 'Access-Control-Allow-';
  var ORIGIN = ALLOW + 'Origin';
  var METHODS = ALLOW + 'Methods';
  var HEADERS = ALLOW + 'Headers';
  var CREDENTIALS = ALLOW + 'Credentials';
  return function(request, response, next) {
    onHeaders(response, function() {
      if (allowMethods) {response.set(METHODS, allowMethods)}
      if (allowHeaders) {
        response.set(HEADERS, allowHeaders);
        if (allowHeaders.indexOf('Authorization') >= 0) {
          response.set(CREDENTIALS, 'true')
        }
      }
      if (allowOrigin) {
        // Convert '*' into actual origin if possible
        var allow = allowOrigin;
        var origin = request.get('origin');
        if (allow == '*' && origin) {
          allow = origin;
        }
        response.set(ORIGIN, allow)
      }
    })
    next();
  }
}

/**
 * Add support for consistent parameter processing
 *
 * This adds a method to the request object called getParams, returning an object
 * containing the requested params from various areas of the request.
 *
 * Using getParams to gather params into one object provides a consistent
 * pattern for specifying parameters and common requirement handling.
 *
 * All required parameters are processed vs. failing on the first required
 * parameter, giving the caller more substantive debugging information.
 *
 * getParams() accepts an object with the following elements:
 *
 *   url|path - Params in path portion of the URL specified by /some/endpoint/:paramName/...
 *   header - Named header parameters
 *   cookie - Named cookie (should all be optional)
 *   body - Named body parameters
 *   query|search - Named query parameters past the ? in the url
 *
 * If specified, the section includes an array of parameter names to retrieve.
 * Each parameter is considered required unless prepended with a '*'. Example:
 *
 *   var params = request.getParams({url:['siteId'], body:['name', 'email', '*org']})
 */
app.addConsistentParameterProcessing = function() {
  return function(request, response, next) {
    request.getParams = function(sections) {
      if (sections.url) {sections.path = sections.url}
      if (sections.search) {sections.query = sections.search}
      var params = {}
      var missingParameters = false
      var missingFormParameters = {}
      var getParamsFromSection = function(source, sectionName) {
        var paramNames = sections[sectionName]
        if (paramNames && paramNames.length) {
          _.forEach(paramNames, function(paramName) {
            var required = true
            if (paramName.substr(0,1) === '*') {
              required = false
              paramName = paramName.substr(1);
            }
            var paramValue = sectionName === 'header' ? request.get(paramName) : source[paramName]
            if (paramName === 'password' && request.hiddenPassword) {
              paramValue = request.hiddenPassword
            }
            if (paramValue !== undefined) {
              params[paramName] = paramValue;
            }
            else if (required) {
              missingParameters = true
              if (sectionName === 'body') {
                missingFormParameters[paramName] = 'Required'
              }
              if (response.addWarning) {
                response.addWarning('Missing request ' + sectionName + ' parameter: ' + paramName)
              }
            }
          })
        }
      }
      getParamsFromSection(request.params, 'path')
      getParamsFromSection(request.get, 'header')
      getParamsFromSection(request.cookies, 'cookie')
      getParamsFromSection(request.body, 'body')
      getParamsFromSection(request.query, 'query')
      if (missingParameters) {
        if (response.formError && Object.keys(missingFormParameters).length) {
          throw response.FormError(missingFormParameters)
        }
        throw new HttpError.BadRequest('Missing required input parameters')
      }
      return params;
    }
    next();
  }
}

/**
 * Hide password from the form post
 */
app.hidePassword = function() {
  return function(request, response, next) {
    if (request.body && request.body.password) {
      request.hiddenPassword = request.body.password
      request.body.password = "********"
    }
    next()
  }
}

/**
 * Add a response.addCookie() to allow multiple cookies to be set
 *
 * This can be called any time throughout the request pipeline, and can
 * be called multiple times to set multiple cookies.
 *
 * It tracks all cookies added, and sends them all to the Set-Cookie
 * header at once, when headers are being written.
 *
 * response.addCookie(cookieString)
 */
app.addResponseCookies = function() {
  return function(request, response, next) {
    var cookies = []
    response.addCookie = function(name, value) {
      cookies.push(name + '=' + value)
    }
    response.clearCookie = function(name) {
      response.addCookie(name, CLEAR_COOKIE)
    }
    onHeaders(response, function() {
      if (cookies.length) {
        response.header('Set-Cookie', cookies)
      }
    })
    next()
  }
}

/**
 * Add support for supplying metadata to the response
 *
 * Metadata is fairly unstructured, generally for debgugging
 *
 * Errors cause the request to fail, and are handled by throwing HttpErrors
 * Warnings don't cause the request to fail, and are added as metadata
 *
 * response.addWarning(string) // Specific warning
 * response.addMoreInfo(url)   // More information - text, url, etc.
 * {
 *   meta: {
 *     warnings: ["warning1", "warning2"]
 *     moreInfo: ["https://some-url"]
 *   }
 * }
 */
app.addMetaSupport = function() {
  return function(request, response, next) {
    var meta = response.meta = response.meta || {}
    meta.warnings = [];
    meta.moreInfo = [];
    response.addWarning = function(warning) {meta.warnings.push(warning)}
    response.addMoreInfo = function(url) {meta.moreInfo.push(url)}
    var oldSend = response.send
    response.send = function() {
      var arg1 = arguments[0];
      if (_.isObject(arg1)) {
        if (meta.warnings.length) {
          arg1.meta = arg1.meta || {};
          arg1.meta = _.extend(arg1.meta, {warnings: meta.warnings});
        }
        if (meta.moreInfo.length) {
          arg1.meta = arg1.meta || {};
          arg1.meta = _.extend(arg1.meta, {moreInfo: meta.moreInfo});
        }
      }
      response.send = oldSend
      oldSend.apply(this, arguments)
    }
    next();
  }
}

/**
 * Error handling
 *
 * This is called when next(e) is issued with an error. The error is
 * usually an HttpError unless it's an uncaught exception.
 *
 * The error object can contain the following:
 *
 * @param code {Number} The numeric http error code (HttpError sets this)
 * @param name {String} The http error name (NotFound, etc)
 * @param message {String} Message sent to the requester
 * @param log {String||Object} Private object to add to the error log
 *
 * In addition, if the response object has 'meta.errors' or 'meta.warnings', 
 * those will be placed into the JSON response.
 *
 * If this is a browser accepting HTML but not application/json,
 * it will get redirected to an oops page. This can be overridden
 * by setting response.redirectToOnError="http://redirect.to" beore
 * throwing an error.
 */
app.finalErrorHandler = function() {
  return function(error, request, response, next) {
    var message = error.message || _.map(error.errors, 'message').join(', ')
    var statusCode = error.statusCode || error.status || 500;
    var name = error.name || HttpError(statusCode).name;
    var inernalReport = void 0
    var hostname = require('os').hostname()
    response.status(statusCode);
    if (statusCode >= 500) {

      // Don't expose internal error info
      name = HttpError(statusCode).name;
      message = request.id ? 'Reference requestId: ' + request.id : '(see logs)'

      // Build the replay command
      var replay = 'curl -v ' + 
          request.protocol + '://' + request.headers.host + request.originalUrl +
          ' -X ' + request.method
      Object.keys(request.headers).forEach(function(headerName) {
        replay += ' -H \'' + headerName + ': ' + request.headers[headerName] + '\''
      })
      if (request.body && Object.keys(request.body).length) {
        replay += ' -d \'' + JSON.stringify(request.body) + '\''
      }

      // Build an error report for logging
      internalReport = {
        name: name,
        statusCode: statusCode,
        message: message,
        hostname: hostname,
        method: request.method,
        url: request.url,
        requestId: request.id,
        headers: request.headers,
        body: request.body,
        replay: replay
      }
      if (request.cookies && internalReport.headers.cookie) {
        internalReport.headers.cookie = request.cookies
      }
      console.error('Caught: ' + JSON.stringify(internalReport,null,2))
      if (error.stack) {
        console.error('Stack: ', error.stack)
      }
      else {
        console.error('Error: ', error)
      }
    }

    // Cleansed for client use
    clientReport = {
      name: name,
      statusCode: statusCode,
      message: message,
      timestamp: new Date().toISOString(),
      requestId: request.id,
      meta: response.meta
    }

    // Send JSON if API, redirect if browser
    var accepts = request.get('accept')
    var acceptsAll = !accepts || accepts === '*/*'
    var jsonReply = (acceptsAll || accepts.indexOf('application/json') === 0)
    if (jsonReply) {
      response.send(clientReport)
    }
    else {
      if (response.redirectToOnError) {
        response.redirect(response.redirectToOnError)
      }
      else {
        app.setFormData(clientReport, request, response)
        response.redirect(OOPS_PAGE)
      }
    }

    if (response.postErrorHandler) {
      try {
        response.postErrorHandler(error, request, response, clientReport, internalReport)
      }
      catch(e){}
    }

    next()
  }
}