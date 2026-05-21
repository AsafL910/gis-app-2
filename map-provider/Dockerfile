FROM node:22-bookworm-slim AS frontend-builder

WORKDIR /frontend

COPY frontend/package.json frontend/tsconfig.json frontend/tsconfig.node.json frontend/vite.config.ts frontend/index.html ./
RUN npm install

COPY frontend/src ./src
RUN npm run build

FROM python:3.12-slim

WORKDIR /app

RUN apt-get update \
  && apt-get install -y --no-install-recommends gdal-bin libgdal-dev python3-venv \
  && rm -rf /var/lib/apt/lists/*

ENV GDAL_CONFIG=/usr/bin/gdal-config
ENV CPLUS_INCLUDE_PATH=/usr/include/gdal
ENV C_INCLUDE_PATH=/usr/include/gdal

RUN python -m venv /opt/venv
ENV PATH="/opt/venv/bin:${PATH}"

COPY pixi.toml service-version.json README.md ./
COPY src ./src
COPY --from=frontend-builder /frontend/dist ./frontend-dist

RUN python -m pip install --no-cache-dir fastapi uvicorn rasterio numpy

ENV PORT=8003
ENV DATA_DIR=/app/data
EXPOSE 8003

CMD ["python", "-m", "uvicorn", "src.main:app", "--host", "0.0.0.0", "--port", "8003"]
