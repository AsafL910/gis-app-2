FROM node:22-bookworm-slim AS builder

WORKDIR /app

ARG VITE_MAP_PROVIDER_BASE_URL=/map-provider-api
ARG VITE_HAT_PROVIDER_BASE_URL=/hat-provider-api
ARG VITE_MAP_URL=/map-provider-api/wmts?SERVICE=WMTS&REQUEST=GetCapabilities

ENV VITE_MAP_PROVIDER_BASE_URL=$VITE_MAP_PROVIDER_BASE_URL
ENV VITE_HAT_PROVIDER_BASE_URL=$VITE_HAT_PROVIDER_BASE_URL
ENV VITE_MAP_URL=$VITE_MAP_URL

COPY package.json tsconfig.json tsconfig.node.json vite.config.ts index.html ./
RUN npm install

COPY src ./src

RUN npm run build

FROM nginx:1.27-alpine

COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=builder /app/dist /usr/share/nginx/html

EXPOSE 4174

CMD ["nginx", "-g", "daemon off;"]
