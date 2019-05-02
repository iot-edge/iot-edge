var databus = require('./api/databus');

// SocketIO routes
module.exports = function(io) {
  io.of('/databus').on('connection', databus.socket);
  console.log('Serving SocketIO connections with namespace /databus');
};
