FROM node:22-bookworm-slim AS builder

WORKDIR /app

COPY package.json tsconfig.json tsconfig.node.json vite.config.ts index.html ./
RUN npm install

COPY src ./src

RUN npm run build

FROM nginx:1.27-alpine

COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=builder /app/dist /usr/share/nginx/html

EXPOSE 5173

CMD ["nginx", "-g", "daemon off;"]
