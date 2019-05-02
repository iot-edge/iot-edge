module.exports = {
  'iot-edge': {
    site: {
      id: process.env.SITE_ID || "site",
      name: process.env.SITE_NAME || "Edge Site",
      TZ: process.env.TZ || "America/Los_Angeles"
    },
    server: {
      port: 9002,
      interface: "0.0.0.0"
    },
    externalExposure: {
      serverFQDN: "localhost",
      httpPort: 8000,
      mqttPort: 1883,
      mqttWebSocketPort: 9001
    },
    persist: {
      store: 'file',
      file: {
        dir: '/mnt/edge/persist'
      }
    },
    grafana: {
      host: "grafana",
      port: "3000",
      user: "admin",
      password: "admin"
    },
    nodered: {
      host: "nodered",
      port: "1880",
      path: '/' + process.env.SITE_ID + '/node-red'
    },
    morgan: {
      logType: 'combined',
      config: {
        skip: function (req, res) { return res.statusCode < 400 },
      }
    }
  }
}