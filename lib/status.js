var HttpError = require('httperrors')
var Status = module.exports = {}
Status.getStatus = function(request, response) {
  response.send({
    status: "OK",
    siteId: process.env.SITE_ID
  })
}
