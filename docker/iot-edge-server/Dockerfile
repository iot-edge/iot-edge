# The iot-edge server based on iot-edge-node-js
FROM microclimates/iot-edge-node-js:prod

# Edge server
RUN npm install -g iot-edge@2.3.2
EXPOSE 9002
WORKDIR /usr/local/lib/node_modules/iot-edge

CMD ["node", "app.js"]