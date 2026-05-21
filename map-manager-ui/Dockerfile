FROM node:22-bookworm-slim

WORKDIR /app

COPY package.json tsconfig.json tsconfig.node.json vite.config.ts index.html ./
RUN npm install

COPY src ./src

ENV PORT=5173
ENV VITE_PROXY_TARGET=http://map-manager:4000
EXPOSE 5173

CMD ["npm", "run", "dev", "--", "--host", "0.0.0.0", "--port", "5173"]
