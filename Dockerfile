FROM node:20-alpine
WORKDIR /app
COPY . .
RUN npm run install:all && npm run build:client
CMD ["node", "server/index.js"]
