# Build Stage
FROM rust:1-slim-bookworm AS builder

# Install required build dependencies
RUN apt-get update && apt-get install -y \
    pkg-config \
    libssl-dev \
    gcc \
    libc6-dev

WORKDIR /app

# Cargo fayllarını əvvəlcə kopyalayırıq ki, dependency-lər cache-də qalsın
COPY Cargo.toml Cargo.lock ./
# Dummy src yaradaraq asılılıqları (dependencies) yükləyib build edirik
RUN mkdir src && echo "fn main() {}" > src/main.rs && cargo build --release
RUN rm -f target/release/deps/masterdeploy_rust* src/main.rs

# İndi əsl kodu kopyalayırıq
COPY . .

# Və yalnız bizim kodumuz compile olur (dependency-lər cache-dən gəlir)
RUN cargo build --release

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
COPY --from=builder /app/target/release/masterdeploy-rust /usr/local/bin/masterdeploy-rust

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
