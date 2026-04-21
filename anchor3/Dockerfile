FROM node:20-alpine
WORKDIR /app
RUN apk add --no-cache docker-cli docker-compose
COPY package*.json ./
RUN npm install
COPY . .
RUN npm run build
EXPOSE 7779
CMD ["node", "server.js"]
