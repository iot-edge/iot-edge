# <img src="https://github.com/iot-edge/iot-edge-docs/raw/master/docs/_media/iot-edge-green-bg-100.png" width="60"/><br/>Open IoT Edge Server

An [Edge Server](https://en.wikipedia.org/wiki/Edge_computing) is a software device deployed close to systems requiring integration and automation.

The [Open IoT Edge](https://github.com/iot-edge) project brings industry leading software into an
edge server for integrating and automating business processes with on-site IoT devices.

The server can be deployed on-site or in the cloud - close to your integrations.

It uses 
![docker](https://iot-edge.github.io/iot-edge-docs/_media/icon/docker.png) [Docker](https://www.docker.com) to compose the following components into a full featured edge server:

- ![Grafana](https://iot-edge.github.io/iot-edge-docs/_media/icon/grafana.png) [Grafana](https://grafana.com/) - Beautiful analytics, monitoring, and user interface
- ![nodered](https://iot-edge.github.io/iot-edge-docs/_media/icon/nodered.png) [Node-Red](https://nodered.org) - Flow-based automation for the Internet of Things
- ![iot-edge](https://iot-edge.github.io/iot-edge-docs/_media/icon/iot-edge.png) [IoT-Edge](https://github.com/iot-edge/iot-edge) - Device management and automation plugins
- ![graphite](https://iot-edge.github.io/iot-edge-docs/_media/icon/graphite.png) [Graphite](https://graphiteapp.org/) - Time-Series database for metrics storage
- ![statsd](https://iot-edge.github.io/iot-edge-docs/_media/icon/statsd.png) [Statsd](https://www.npmjs.com/package/statsd) - Realtime metrics collection and aggregation
- ![redis](https://iot-edge.github.io/iot-edge-docs/_media/icon/redis.png) [Redis](https://redis.io) - Performance database, text search, and more
- ![loki](https://iot-edge.github.io/iot-edge-docs/_media/icon/loki.png) [Loki](https://grafana.com/loki) - Activity database for event and log storage
- ![mosquitto](https://iot-edge.github.io/iot-edge-docs/_media/icon/mosquitto.png) [Mosquitto](https://mosquitto.org) - IoT sensor message bus
- ![nginx](https://iot-edge.github.io/iot-edge-docs/_media/icon/nginx.png) [Nginx](https://www.nginx.com) - Enterprise grade routing, logging, and security

## Quick Start

First make sure you've installed these prerequisites

  * [NodeJS](https://nodejs.org)
  * [Docker](https://www.docker.com/products)

Next, build yourself a server in a new folder

```bash
npm install -g yo generator-edge
yo edge
```

Now start the server

```bash
npm start
```

And view it from your browser

```bash
http://localhost:8000/
```

## Up Next...

Visit our [documentation pages](https://iot-edge.github.io/iot-edge-docs/#/) to get the most from your automation server

## Project Guidelines

* *Fast* - Get started, deploy, iterate quickly
* *Open* - Built with open source components, free license
* *Secure* - Enterprise grade security components
* *Extensible* - Stable core with plugin modules for customization
* *Supported* - Developer tools and community support forum

## License

May be freely distributed under the [MIT license](https://raw.githubusercontent.com/iot-edge/iot-edge/master/LICENSE).

Copyright (c) 2019 [Microclimates](https://github.com/microclimates) and the 
[Open IoT Edge contributors](https://github.com/iot-edge/iot-edge/graphs/contributors)