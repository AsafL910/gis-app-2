FROM node:22-bookworm-slim AS builder

WORKDIR /app

COPY package.json tsconfig.json ./
RUN npm install

COPY src ./src

RUN npm run build

FROM node:22-bookworm-slim

WORKDIR /app

RUN apt-get update \
  && apt-get install -y --no-install-recommends gdal-bin \
  && rm -rf /var/lib/apt/lists/*

COPY package.json ./
RUN npm install --omit=dev

COPY --from=builder /app/dist ./dist

ENV PORT=4000
EXPOSE 4000

CMD ["npm", "run", "start"]
