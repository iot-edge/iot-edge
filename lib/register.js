var HttpError = require('httperrors')
var Router = require('express-promise-router')
var Request = require('request-promise')
var Persist = require('./persist');
var Databus = require('./api/databus');
var Hub = Persist.Hub;
var User = Persist.User;
var ServicePlan = Persist.ServicePlan;
var HubAPI = require('./api/hub');
var Account = Persist.Account;
var _ = require('lodash')

// Site registration
var Register = module.exports = Router()

// Site registration is called exactly once, from the cloud, from within the
// sitePlan.js registerSitePlan() method.
//
// Input:
// {
//   owner: {
//     id: owner.id,
//     firstName: owner.firstName,
//     lastName: owner.lastName,
//     email: owner.email,
//   },
//   account: { <- optional
//     id: uuid,
//     name: account name
//   }
//   servicePlan: {
//     id: "BUSINESS",
//     name: "Business plan"
//   }
//   siteName: site.name,
//   timezone: timezone
// }
Register.site = function(request, response) {
  var params = request.getParams({body:['owner', '*account', 'servicePlan', '*siteName','*timezone']});
  var owner, hub, account, servicePlan;

  return Hub.loadSingleton()
    .then(function(node) {
      hub = node;
      hub.name = params.siteName || hub.name;
      if (hub.links.owner && hub.links.owner.href) {
        throw new HttpError.BadRequest('Cannot register site - already registered.');
      }

      owner = new User(params.owner);
      owner.roles = 'owner';
      hub.addLink('owner', owner);

      if (params.account && params.account.id) {
        account = new Account({id:params.account.id, name:params.account.name});
        hub.addLink('account', account);
      }

      servicePlan = new ServicePlan({id:params.servicePlan.id, name:params.servicePlan.name});
      hub.addLink('servicePlan', servicePlan);

      var promises = [owner.save(), hub.save(), servicePlan.save()];
      if (account) {
        promises.push(account.save());
      }
      return Promise.all(promises);
    })
    .then(function() {
      if (params.siteName || params.timezone) {
        return HubAPI.saveSharedHubInfo({hubName: params.siteName, timezone: params.timezone});
      }
    })
    .then(function() {
      response.send({status:'ok'});
    })
}

// Site registration - one time shot
Register.post('/register', Register.site)
