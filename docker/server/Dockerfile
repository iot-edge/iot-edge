# The iot-edge server based on iotedge/node-js
FROM iotedge/node-js:prod

# Edge server
RUN npm install -g iot-edge@2.4.1
EXPOSE 9002
WORKDIR /usr/local/lib/node_modules/iot-edge

CMD ["sh", "-c", "exec /startup.sh"]
