FROM node:24-alpine
ENV NODE_ENV=production PORT=3000 HOST=0.0.0.0 TZ=America/Edmonton DATA_DIR=/app/data
WORKDIR /app
COPY package.json server.mjs db.mjs http-utils.mjs admin-auth.mjs admin-routes.mjs admin-tools.mjs ./
COPY public ./public
COPY scripts ./scripts
RUN mkdir -p /app/data && chown -R node:node /app
USER node
EXPOSE 3000
VOLUME ["/app/data"]
CMD ["node", "server.mjs"]
