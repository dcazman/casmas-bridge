FROM node:20-alpine

RUN apk add --no-cache git openssh docker-cli docker-cli-compose

WORKDIR /app

COPY package.json .
RUN npm install

COPY mcp-server.js .
COPY start.sh .

RUN chmod +x start.sh

EXPOSE 8000

CMD ["./start.sh"]
