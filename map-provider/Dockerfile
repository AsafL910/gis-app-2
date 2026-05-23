FROM node:22-bookworm-slim AS frontend-builder

WORKDIR /frontend

COPY frontend/package.json frontend/tsconfig.json frontend/tsconfig.node.json frontend/vite.config.ts frontend/index.html ./
RUN npm install

COPY frontend/src ./src
RUN npm run build

FROM python:3.12-slim

WORKDIR /app

COPY service-version.json ./
COPY src ./src
COPY --from=frontend-builder /frontend/dist ./frontend-dist

RUN python -m pip install --no-cache-dir fastapi uvicorn

ENV PORT=8003
ENV DATA_DIR=/app/data
EXPOSE 8003

CMD ["python", "-m", "uvicorn", "src.main:app", "--host", "0.0.0.0", "--port", "8003"]
