module.exports = {
  "iot-edge": {
    server: {
      port: 9002,
      interface: "0.0.0.0"
    },
    externalExposure: {
      httpPort: 8000,
      mqttPort: 1883,
      mqttWebSocketPort: 9001
    }
  }
}