# Base NodeJS image - Trim O/S + NodeJS LTS + extensions listed below
FROM node:10-jessie-slim

# Mosquitto clients - for password management and MQTT I/O
RUN apt-get update && \
    apt-get install -y --no-install-recommends \
      vim mosquitto mosquitto-clients

# Graphicsmagick - for graphics automation
RUN apt-get update && \
    apt-get install -y --no-install-recommends \
      graphicsmagick

# Headless chrome - for report engine & browser automation
RUN apt-get update && \
    apt-get install -y --no-install-recommends \
      libpangocairo-1.0-0 libx11-xcb1 libxcomposite1 libxcursor1 libxdamage1 libxi6 libxtst6 \
      libnss3 libcups2 libxss1 libxrandr2 libgconf2-4 libasound2 libatk1.0-0 libgtk-3-0

# Install common nodejs modules that need compilation
RUN chmod a+w /usr/local/lib /usr/local/lib/node_modules
USER node
RUN npm install -g puppeteer gm sqlite3
USER root

# Cleanup
RUN apt-get clean

CMD ["node"]