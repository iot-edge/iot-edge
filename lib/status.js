var HttpError = require('httperrors')
var Status = module.exports = {}
Status.getStatus = function(request, response) {
  response.send(JSON.stringify({
    status: "OK",
    siteId: process.env.SITE_ID
  }, null, 2) + '\n');
}
