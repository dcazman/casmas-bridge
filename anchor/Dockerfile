FROM node:20-alpine

RUN apk add --no-cache python3 make g++ git

WORKDIR /app

COPY package.json .
RUN npm install

COPY server.js .
COPY start.sh .
COPY lib/ ./lib/
COPY routes/ ./routes/
COPY assets/ ./assets/

RUN chmod +x start.sh

VOLUME ["/data"]

EXPOSE 7778

CMD ["./start.sh"]
