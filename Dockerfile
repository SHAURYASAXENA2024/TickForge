

FROM ubuntu:24.04

ENV DEBIAN_FRONTEND=noninteractive

RUN apt-get update && apt-get install -y \
    python3 python3-dev python3-venv python3-pip \
    cmake g++ build-essential curl git nginx pkg-config \
    && rm -rf /var/lib/apt/lists/*

RUN curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y
ENV PATH="/root/.cargo/bin:${PATH}"

RUN curl -fsSL https://deb.nodesource.com/setup_22.x | bash - \
    && apt-get install -y nodejs \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY . /app

RUN python3 -m venv /app/.venv

RUN /app/.venv/bin/pip install --no-cache-dir maturin==1.16.0 \
    -r /app/services/exchange-api/requirements.txt \
    -r /app/services/market-data/requirements.txt

RUN cd /app/storage && \
    VIRTUAL_ENV=/app/.venv \
    PATH="/app/.venv/bin:$PATH" \
    maturin develop --release

RUN cmake -S /app/engine -B /app/.run/build/engine \
    -DCMAKE_BUILD_TYPE=Release && \
    cmake --build /app/.run/build/engine -j2

RUN cd /app/frontend && \
    npm ci --no-audit --no-fund && \
    npm run build

RUN chmod +x /app/render-start.sh

COPY nginx.conf /etc/nginx/sites-available/default

ENV PORT=10000

EXPOSE 10000

CMD ["bash", "/app/render-start.sh"]
