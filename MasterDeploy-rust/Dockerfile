# Build Stage
FROM rust:1-slim-bookworm AS builder

# Install required build dependencies
RUN apt-get update && apt-get install -y \
    pkg-config \
    libssl-dev \
    gcc \
    libc6-dev && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Əsl kodu kopyalayırıq
COPY . .

# ⚡ DOCKER BUILDX CACHE MOUNT: Cargo registry və target qovluqlarını keşləyirik.
RUN --mount=type=cache,target=/usr/local/cargo/registry \
    --mount=type=cache,target=/app/target \
    cargo build --release && \
    cp /app/target/release/masterdeploy-rust /app/masterdeploy-rust

# ---------------------------------------------------
# Runtime Stage (Yüngül və son imic)
FROM debian:bookworm-slim

# Runtime üçün lazımlı kitabxanalar (SSH, OpenSSL, SQLite, Git)
RUN apt-get update && apt-get install -y \
    libssl3 \
    sqlite3 \
    openssh-client \
    curl \
    ca-certificates \
    git \
    && rm -rf /var/lib/apt/lists/*

# Yüngül Docker CLI yükləyirik (bütün docker daemon yox, yalnız client lazımdır - həcmi kiçiltmək üçün)
RUN curl -fsSLO https://download.docker.com/linux/static/stable/x86_64/docker-24.0.7.tgz \
    && tar xzvf docker-24.0.7.tgz --strip 1 -C /usr/local/bin docker/docker \
    && rm docker-24.0.7.tgz

WORKDIR /app

# Binary faylı builder stage-dən gətiririk
COPY --from=builder /app/masterdeploy-rust /usr/local/bin/masterdeploy-rust

# Frontend fayllarını (UI) gətiririk
COPY --from=builder /app/static /app/static

# Baza (SQLite) üçün qovluq hazırlayırıq
RUN mkdir -p /app/data

# SSH açarlarının yazılması üçün lazımi icazələri (permissions) qururuq
RUN mkdir -p /root/.ssh && chmod 700 /root/.ssh

# Default port
EXPOSE 3000

# Proqramı işə salırıq
CMD ["masterdeploy-rust"]
