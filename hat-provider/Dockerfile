FROM python:3.11-slim

WORKDIR /app

COPY app ./app

RUN python -m pip install --no-cache-dir fastapi uvicorn numpy rasterio

ENV PORT=8004
ENV DATA_DIR=/app/data
EXPOSE 8004

CMD ["python", "-m", "uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8004"]
