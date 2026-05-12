FROM node:24-bookworm-slim

WORKDIR /app

COPY package*.json ./
RUN npm ci --omit=dev

COPY public ./public
COPY src ./src

ENV NODE_ENV=production
ENV PORT=3001
EXPOSE 3001

VOLUME ["/app/data"]

CMD ["node", "--experimental-sqlite", "src/server.js"]
