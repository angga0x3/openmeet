# syntax=docker/dockerfile:1

FROM node:22-bookworm-slim AS web
WORKDIR /web
COPY apps/desktop/package.json apps/desktop/package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY apps/desktop/ ./
RUN npm run build

FROM rust:1.90-bookworm AS server
WORKDIR /src
COPY Cargo.toml Cargo.lock ./
COPY crates ./crates
RUN cargo build --release -p openmeet-signaling

FROM debian:bookworm-slim
RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates \
    && rm -rf /var/lib/apt/lists/* \
    && useradd --uid 10001 --create-home app
WORKDIR /app
COPY --from=server /src/target/release/openmeet-signaling /usr/local/bin/openmeet-signaling
COPY --from=web /web/dist /app/web
ENV OPENMEET_WEB_DIR=/app/web \
    OPENMEET_MAX_PARTICIPANTS=25
USER app
EXPOSE 8770
ENTRYPOINT ["openmeet-signaling"]
