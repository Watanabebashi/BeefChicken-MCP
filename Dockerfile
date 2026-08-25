FROM node:22-trixie-slim

WORKDIR /app

COPY package*.json ./
RUN npm ci --omit=dev

COPY . .
RUN chmod +x scripts/docker-entrypoint.sh && chown -R node:node /app

ENV HOST=0.0.0.0
EXPOSE 3000
USER node

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/mcp').then(r=>process.exit(r.status<500?0:1)).catch(()=>process.exit(1))"

ENTRYPOINT ["scripts/docker-entrypoint.sh"]
CMD ["npm", "start"]
