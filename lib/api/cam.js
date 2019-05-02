var config = require('config').get('iot-edge');
var onvif = require('node-onvif');
var Databus = require('./databus');
var HttpError = require('httperrors')
var AuthC = require('../authenticate');
var AuthZ = require('../authorize');
var Router = require('express-promise-router')
var Device = require('../persist').Device;
var Request = require('request');
var _ = require('lodash')

// Camera utilities
var cam = module.exports = Router()

// Get the camDevice from the request
cam.getCam = async function(request) {
  var camId = request.getParams({url:['camId']}).camId;
  var camDevice;
  try {
    return await Device.load(camId);
  }
  catch(e) {
    throw HttpError.NotFound('camId not found');
  }
  return camDevice;
}

// Verify username/password for a camera
cam.verifyUser = async function(request, response) {
  var params = request.getParams({url:['camId'],query:['user','pass']});
  var camDevice = await cam.getCam(request);

  var onvifConfig = camDevice.config.onvif;
  if (!onvifConfig) {
    return response.status(400).send({status:'Device not registered as an onvif device'});
  }
 
  // Create an OnvifDevice object
  let onvifDevice = new onvif.OnvifDevice({
    xaddr: onvifConfig.addr,
    user : params.user,
    pass : params.pass
  });
 
  // Initialize the OnvifDevice
  try {
    var info = await onvifDevice.init()
  }
  catch(e) {
    var errStr = e.toString();
    if (errStr.match(/ECONNREFUSED/)) {
      response.status(503).send({status:'ERR_NOT_CONNECTED', msg:'Camera not connected'});
    }
    else if (errStr.match(/uthorized/)) {
      response.status(503).send({status:'ERR_UNAUTHORIZED', msg:'Username/Password not correct'});
    }
    else {
      return response.status(503).send({status:'ERR_UNKNOWN', msg:errStr});
    }
    return;
  }

  // Persist user/pass if successful
  if (params.user !== onvifConfig.user || params.pass !== onvifConfig.pass) {
    onvifConfig.user = params.user;
    onvifConfig.pass = params.pass;
    await camDevice.save();
  }

  response.send({status:'OK', msg:'Success', name:camDevice.name});
}

// Discover the camera, persist if a different addr
cam.discover = async function(request, response) {
  var camDevice = await cam.getCam(request);
  await cam._discover(camDevice)
  response.send({status:'discovered', msg:'Success', name:camDevice.name});
}

// Discover the camera, persist if a different addr
cam._discover = async function(camDevice) {
  var foundItem = null;
  Databus.postMessage('devices/mc-site/onvif/scan/set','y');
  var items = JSON.parse(await Databus.getNextMessage('devices/mc-site/onvif/scan'))
  items.forEach((item) => {
    if (item.urn == camDevice.config.onvif.urn) {
      foundItem = item;
    }
  });
  if (!foundItem) {
    throw HttpError.NotFound('Cam not found');
  }
  if (foundItem.addr != camDevice.config.onvif.addr) {
    camDevice.config.onvif.addr = foundItem.addr;
    await camDevice.save();
  }
}

// Get and reset snapshot URL if necessary
cam.getSnapshotURL = async function(request, response) {
  var camDevice = await cam.getCam(request);
  await cam._getSnapshotURL(camDevice)
  response.send({status:'snapURL', msg:'Success', url:camDevice.config.snapshotURL});
}

// Get and persist the snapshot URL & image type
cam._getSnapshotURL = async function(camDevice) {

  var onvifConfig = camDevice.config.onvif;
  if (!onvifConfig) {
    return response.status(400).send({status:'Device not registered as an onvif device'});
  }
 
  // Create an OnvifDevice object
  let onvifDevice = new onvif.OnvifDevice({
    xaddr: onvifConfig.addr,
    user : onvifConfig.user,
    pass : onvifConfig.pass
  });

  // Get the snapshot URL
  try {
    await onvifDevice.init()
  }
  catch(e) {
    var errStr = e.toString();
    if (errStr.match(/ECONNREFUSED/)) {
      throw HttpError[400]({status:'ERR_NOT_CONNECTED', msg:'Camera not connected'});
    }
    else if (errStr.match(/uthorized/)) {
      throw HttpError[401]({status:'ERR_UNAUTHORIZED', msg:'Username/Password not correct'});
    }
    else {
      throw HttpError[503]({status:'ERR_UNKNOWN', msg:errStr});
    }
    return;
  }

  // Make sure this is a snapshot compatible onvif device
  if (!onvifDevice.current_profile) {
    throw HttpError[503]({status:'INCOMPATIBLE', msg:'Camera has no default media profile'});
  }
  if (!onvifDevice.current_profile.snapshot) {
    throw HttpError[503]({status:'INCOMPATIBLE', msg:'Camera has no snapshot capability'});
  }

  // Set the snapshot URI into the camDevice, and persist if changed.
  let snapshotURL = onvifDevice.current_profile.snapshot;
  if (snapshotURL != camDevice.config.snapshotURL) {
    camDevice.config.snapshotURL = snapshotURL;
    await camDevice.save();
  }

}

// Attempt to reconnect to the camera
cam._reconnect = async function(camDevice) {
  await cam._discover(camDevice);
  await cam._getSnapshotURL(camDevice);
}

// Capture and return a snapshot. 
// This will attempt to reset the snapshot url if necessary.
cam.snap = async function(request, response) {
  var camDevice = await cam.getCam(request);

  // First time...
  if (camDevice.config.onvif && !camDevice.config.snapshotURL) {
    await cam._reconnect(camDevice)
  }

  Request.get(camDevice.config.snapshotURL)
    .on('error', function(err) {
      // No love
      var errMsg = '500 - Snap fetch error: ' + err.message;
      response.status(500).send(errMsg);
      if (camDevice.config.onvif) {
        cam._reconnect(camDevice);
      }
    })
    .on('end', function(rsp) {
      // Save image type
      var statusCode = response.statusCode;
      var contentType = response.get('content-type');
      if (statusCode == 200) {
        var exts = {
          'image/jpeg':'jpg',
          'image/png':'png'
        }
        var ext = exts[contentType];
        if (ext && ext !== camDevice.config.snapExt) {
          camDevice.config.snapExt = ext;
          camDevice.save();
        }
      }
    })
    .pipe(response);
}

// Routing table
cam.get('/cam/:camId/verify-user', AuthC.session, AuthZ.role('admin'), cam.verifyUser);
cam.get('/cam/:camId/snap', cam.snap);
// cam.get('/cam/:camId/url', AuthC.session, AuthZ.role('admin'), cam.getSnapshotURL);
// cam.get('/cam/:camId/url', cam.getSnapshotURL);
