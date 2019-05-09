# Docker images for the iot-edge server project

The utilities in the /bin directory are to be run from within one of the 
docker direcories. Example: `cd node-js; ../bin/build`

## iotedge/node-js

An LTS version of NodeJS with a trim O/S and the following extensions

* Mosquitto clients - for MQTT interaction
* Graphicsmagick - for image automation
* Headless Chrome - for reporting engine and browser automation

This image is used as the baseline for other iot-edge images

## iotedge/server

The docker image for the iot-edge server, based on iotedge/node-js

## iotedge/node-red

A NodeRed distribution based on the iotedge/node-js image
