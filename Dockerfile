FROM node:22-trixie-slim

WORKDIR /app

COPY package*.json ./
RUN npm ci --omit=dev

COPY . .
RUN npm run generate

EXPOSE 3000

CMD ["npm", "start"]
