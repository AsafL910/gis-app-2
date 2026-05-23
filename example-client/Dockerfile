FROM node:22-bookworm-slim

WORKDIR /app

COPY package.json tsconfig.json tsconfig.node.json vite.config.ts index.html ./
RUN npm install

COPY src ./src

EXPOSE 4174

CMD ["npm", "run", "dev", "--", "--host", "0.0.0.0", "--port", "4174"]
