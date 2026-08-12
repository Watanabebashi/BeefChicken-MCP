FROM node:22-trixie-slim

WORKDIR /app

COPY package*.json ./
RUN npm ci --omit=dev

COPY . .
RUN chmod +x scripts/docker-entrypoint.sh

ENV HOST=0.0.0.0
EXPOSE 3000

ENTRYPOINT ["scripts/docker-entrypoint.sh"]
CMD ["npm", "start"]
