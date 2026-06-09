FROM python:3.11-slim

WORKDIR /app

ENV PYTHONDONTWRITEBYTECODE=1
ENV PYTHONUNBUFFERED=1

RUN apt-get update \
  && apt-get install -y --no-install-recommends libexpat1 \
  && rm -rf /var/lib/apt/lists/*

COPY app ./app

RUN python -m pip install --no-cache-dir fastapi uvicorn numpy rasterio

ENV PORT=8000
EXPOSE 8000

CMD ["python", "-m", "uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
