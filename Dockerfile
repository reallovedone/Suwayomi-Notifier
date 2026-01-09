FROM node:20-alpine

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY src ./src

RUN mkdir -p /app/state

ENV NODE_ENV=production

CMD ["node", "src/watcher.js"]