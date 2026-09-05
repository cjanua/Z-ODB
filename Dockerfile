# syntax=docker/dockerfile:1
# ─────────────────────────────────────────────────────────────────────────────
# Stage 1: base — Ubuntu 24.04 with Rust + Bun + Tauri Linux system deps
# ─────────────────────────────────────────────────────────────────────────────
FROM ubuntu:24.04 AS base

ENV DEBIAN_FRONTEND=noninteractive
ENV RUSTUP_HOME=/usr/local/rustup
ENV CARGO_HOME=/usr/local/cargo
ENV PATH=/usr/local/cargo/bin:/root/.bun/bin:$PATH

# System deps: build tools + WebKitGTK (Tauri Linux requirement)
RUN apt-get update && apt-get install -y --no-install-recommends \
    curl \
    ca-certificates \
    build-essential \
    pkg-config \
    file \
    libssl-dev \
    # Tauri / WebKitGTK 4.1
    libwebkit2gtk-4.1-dev \
    libgtk-3-dev \
    libayatana-appindicator3-dev \
    librsvg2-dev \
    libglib2.0-dev \
    libsoup-3.0-dev \
    patchelf \
    rpm \
    && rm -rf /var/lib/apt/lists/*

# Install Rust stable
RUN curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs \
    | sh -s -- -y --default-toolchain stable --profile minimal \
    && rustup target add x86_64-unknown-linux-gnu \
    && cargo install tauri-cli --version "^2" --locked

# Install Bun
RUN curl -fsSL https://bun.sh/install | bash

WORKDIR /app

# ─────────────────────────────────────────────────────────────────────────────
# Stage 2: deps — install JS dependencies (cached layer)
# ─────────────────────────────────────────────────────────────────────────────
FROM base AS deps

COPY package.json bun.lockb* ./
RUN bun install --frozen-lockfile

# ─────────────────────────────────────────────────────────────────────────────
# Stage 3: web-builder — produce dist/ (Cloudflare Pages artifact)
# ─────────────────────────────────────────────────────────────────────────────
FROM deps AS web-builder

COPY . .
RUN bun run build

# Inject COOP/COEP headers for CF Pages (required for DuckDB-WASM SharedArrayBuffer)
RUN printf '/*\n  Cross-Origin-Opener-Policy: same-origin\n  Cross-Origin-Embedder-Policy: require-corp\n' \
    > dist/_headers

# ─────────────────────────────────────────────────────────────────────────────
# Stage 4: web — export dist/ as a scratch image for BuildKit --output
# ─────────────────────────────────────────────────────────────────────────────
FROM scratch AS web
COPY --from=web-builder /app/dist /

# ─────────────────────────────────────────────────────────────────────────────
# Stage 5: linux-builder — compile Tauri desktop (.deb / .AppImage)
# ─────────────────────────────────────────────────────────────────────────────
FROM deps AS linux-builder

COPY . .
RUN bun run build && cargo tauri build --bundles deb,appimage

# ─────────────────────────────────────────────────────────────────────────────
# Stage 6: linux — export bundle/ as scratch image
# ─────────────────────────────────────────────────────────────────────────────
FROM scratch AS linux
COPY --from=linux-builder /app/src-tauri/target/release/bundle /
