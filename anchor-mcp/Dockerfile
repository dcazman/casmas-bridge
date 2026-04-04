FROM node:20-alpine

WORKDIR /app

COPY package.json .
RUN npm install

COPY mcp-server.js .
COPY start.sh .

RUN chmod +x start.sh

EXPOSE 8888

CMD ["./start.sh"]
