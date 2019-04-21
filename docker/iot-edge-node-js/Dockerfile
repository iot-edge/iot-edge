# Base NodeJS image - Trim O/S + NodeJS LTS + extensions listed below
FROM node:10-jessie-slim

# Graphicsmagick - for graphics automation
RUN apt-get clean
RUN apt-get update
RUN apt-get install -y --no-install-recommends \
    graphicsmagick \
    && rm -rf /var/lib/apt/lists/*

# Headless chrome - for report engine & browser automation
RUN apt-get clean
RUN apt-get update
RUN apt-get install -y --no-install-recommends \
    libpangocairo-1.0-0 libx11-xcb1 libxcomposite1 libxcursor1 libxdamage1 libxi6 libxtst6 \
    libnss3 libcups2 libxss1 libxrandr2 libgconf2-4 libasound2 libatk1.0-0 libgtk-3-0 \
    && rm -rf /var/lib/apt/lists/*

CMD ["node"]
