FROM ghcr.io/osgeo/gdal:ubuntu-small-latest

WORKDIR /app

RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 python3-pip python3-venv python3-gdal python3-rasterio \
  && rm -rf /var/lib/apt/lists/*

RUN python3 -m venv /opt/venv --system-site-packages
ENV PATH="/opt/venv/bin:${PATH}"

COPY app ./app

RUN python -m pip install --no-cache-dir fastapi uvicorn

ENV PORT=8004
ENV DATA_DIR=/app/data
EXPOSE 8004

CMD ["python", "-m", "uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8004"]
