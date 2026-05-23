FROM ghcr.io/prefix-dev/pixi:latest

WORKDIR /app

COPY pixi.toml pixi.lock README.md ./

RUN pixi install --locked

COPY app ./app

ENV PORT=8004
ENV DATA_DIR=/app/data
EXPOSE 8004

CMD ["pixi", "run", "start"]
