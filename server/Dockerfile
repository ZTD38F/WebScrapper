FROM mcr.microsoft.com/playwright:v1.63.0-noble

WORKDIR /app

COPY server/package.json ./package.json
RUN npm install --omit=dev

COPY server/src ./src

ENV WS_HOST=0.0.0.0
ENV WS_PORT=8787
ENV WS_DATA_DIR=/app/data
ENV WS_HEADLESS=true

EXPOSE 8787

CMD ["node", "src/server.js"]
