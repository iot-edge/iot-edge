# <img src="https://github.com/iot-edge/iot-edge-docs/raw/master/docs/_media/iot-edge-green-bg-100.png" width="60"/><br/>Open IoT Edge Server

The Open IoT Edge project brings best of breed open source components together into a
server that lives on the edge - close to the action.

This server works equally well on the work floor, in a branch office, or in the cloud - wherever automation is needed.

It uses <img src="https://www.docker.com/sites/default/files/d8/Docker-R-Logo-08-2018-Monochomatic-RGB_Moby-x1.png" alt="Docker" width="16"/>
[Docker](https://www.docker.com) to compose the following tools into a full featured automation server:

- [<img src="https://grafana.com/img/fav32.png" alt="Grafana" width="16"/> Grafana](https://grafana.com/) - Beautiful analytics, monitoring, and user interface
- [<img src="https://nodered.org/favicon.ico" alt="Node-Red" width="16"/> Node-Red](https://nodered.org) - Flow-based automation for the Internet of Things
- [<img src="https://iot-edge.github.io/iot-edge-docs/favicon.ico" width="16"/> IoT-Edge](https://github.com/iot-edge/iot-edge) - For managing devices and automation plugins
- [<img src="https://graphiteapp.org/img/favicon-32x32.png" alt="Graphite" width="16"/> Graphite](https://graphiteapp.org/) - Time-Series database for metrics storage
- [<img src="https://github.com/grafana/loki/raw/master/docs/logo.png" alt="Loki" width="16"/> Loki](https://grafana.com/loki) - Activity database for event and log storage
- [<img src="https://mosquitto.org/favicon-16x16.png" alt="Mosquitto" width="16"/> Mosquitto](https://mosquitto.org) - IoT messaging data bus
- <img src="https://docsify.js.org/_media/favicon.ico" alt="Docsify" width="16"/> [Docsify](https://docsify.js.org) - A magical documentation site generator
- [<img src="https://www.nginx.com/wp-content/uploads/2019/01/nginx-favicon.png" alt="Nginx" width="16"/> Nginx](https://www.nginx.com) - Enterprise grade routing, logging, and security

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

Visit our [documentation pages](https://github.com/iot-edge/documentation) to get the most from your automation server

## Project Guidelines

* *Fast* - Get started, deploy, iterate quickly
* *Open* - Built with open source components, free license
* *Secure* - Enterprise grade security components
* *Extensible* - Stable core with plugin modules for customization
* *Supported* - Developer tools and community support forum

## License

May be freely distributed under the [MIT license](https://raw.githubusercontent.com/iot-edge/iot-edge/master/LICENSE).

Copyright (c) 2019 [Loren West](https://github.com/lorenwest), [Microclimates](https://github.com/microclimates),
[and other contributors](https://github.com/iot-edge/iot-edge/graphs/contributors)