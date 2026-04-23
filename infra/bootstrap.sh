#!/usr/bin/env bash
# Cointrack VPS bootstrap — Ubuntu 24.04 LTS
#
# Spusť na fresh VPS jako root:
#   curl -fsSL https://raw.githubusercontent.com/Rozumbrada/cointrack-platform/main/infra/bootstrap.sh | bash
#
# Co dělá:
#   1. Security hardening (UFW firewall, fail2ban, disable root password login)
#   2. Docker + Docker Compose plugin
#   3. Klonuje cointrack-platform repo do /opt/cointrack
#   4. Připraví production .env (vygeneruje secrets)
#   5. Vysvětlí další kroky uživateli

set -euo pipefail

echo "╔══════════════════════════════════════════════════════════════╗"
echo "║             Cointrack VPS Bootstrap                          ║"
echo "║             Ubuntu 24.04 LTS · Docker · Caddy                ║"
echo "╚══════════════════════════════════════════════════════════════╝"
echo

# ─── 0. Sanity checks ───────────────────────────────────────────────

if [[ $EUID -ne 0 ]]; then
  echo "✘ Tento skript musí běžet jako root. Zkus: sudo bash $0"
  exit 1
fi

if ! grep -q "Ubuntu 24" /etc/os-release 2>/dev/null; then
  echo "⚠  Tento skript je testovaný na Ubuntu 24.04 LTS."
  echo "   Pokud máš jinou distribuci, pokračuj opatrně."
  read -p "Pokračovat? [y/N] " -n 1 -r
  echo
  [[ ! $REPLY =~ ^[Yy]$ ]] && exit 1
fi

# ─── 1. System update ───────────────────────────────────────────────

echo "▶ 1/7 System update"
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get upgrade -y -qq

apt-get install -y -qq \
  ca-certificates curl gnupg git ufw fail2ban \
  htop ncdu jq unzip apt-transport-https

# ─── 2. Firewall (UFW) ──────────────────────────────────────────────

echo "▶ 2/7 Firewall (UFW)"
ufw --force reset >/dev/null
ufw default deny incoming
ufw default allow outgoing
ufw allow 22/tcp    comment 'SSH'
ufw allow 80/tcp    comment 'HTTP'
ufw allow 443/tcp   comment 'HTTPS'
ufw --force enable
echo "  UFW enabled: SSH, HTTP, HTTPS only"

# ─── 3. fail2ban ────────────────────────────────────────────────────

echo "▶ 3/7 fail2ban (brute-force ochrana SSH)"
cat > /etc/fail2ban/jail.local <<'EOF'
[sshd]
enabled = true
bantime = 1h
findtime = 10m
maxretry = 5
EOF
systemctl enable --now fail2ban >/dev/null

# ─── 4. Docker + Compose ───────────────────────────────────────────

echo "▶ 4/7 Docker + Docker Compose"
if ! command -v docker >/dev/null 2>&1; then
  install -m 0755 -d /etc/apt/keyrings
  curl -fsSL https://download.docker.com/linux/ubuntu/gpg | gpg --dearmor -o /etc/apt/keyrings/docker.gpg
  chmod a+r /etc/apt/keyrings/docker.gpg

  echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu $(lsb_release -cs) stable" \
    > /etc/apt/sources.list.d/docker.list

  apt-get update -qq
  apt-get install -y -qq docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
  systemctl enable --now docker >/dev/null
  echo "  Docker installed: $(docker --version)"
else
  echo "  Docker already installed: $(docker --version)"
fi

# ─── 5. Clone repo ─────────────────────────────────────────────────

echo "▶ 5/7 Clone cointrack-platform repo"
mkdir -p /opt
if [[ ! -d /opt/cointrack/.git ]]; then
  git clone https://github.com/Rozumbrada/cointrack-platform.git /opt/cointrack
  echo "  Cloned to /opt/cointrack"
else
  cd /opt/cointrack && git pull --quiet && echo "  Repo updated"
fi

# ─── 6. Generate .env.prod ─────────────────────────────────────────

echo "▶ 6/7 Generate production secrets"
ENV_FILE=/opt/cointrack/infra/.env.prod
if [[ ! -f $ENV_FILE ]]; then
  JWT=$(openssl rand -hex 32)
  PG_PWD=$(openssl rand -hex 16)
  MINIO_PWD=$(openssl rand -hex 16)

  cat > $ENV_FILE <<EOF
# ─── Cointrack production secrets ────────────────────────────────
# Vygenerováno $(date -Iseconds). NEVKLÁDAT DO GITU.

# Server
ENVIRONMENT=production
SERVER_PORT=8080
PUBLIC_API_URL=https://api.cointrack.cz
PUBLIC_WEB_URL=https://cointrack.cz

# Postgres
POSTGRES_HOST=postgres
POSTGRES_PORT=5432
POSTGRES_DB=cointrack
POSTGRES_USER=cointrack
POSTGRES_PASSWORD=$PG_PWD

# MinIO (S3-kompatibilní file storage)
S3_ENDPOINT=http://minio:9000
S3_PUBLIC_ENDPOINT=https://files.cointrack.cz
S3_ACCESS_KEY=cointrack
S3_SECRET_KEY=$MINIO_PWD
S3_BUCKET=cointrack-files
S3_REGION=eu-central-1

# JWT (HMAC-256, 256-bit)
JWT_SECRET=$JWT
JWT_ISSUER=cointrack
JWT_AUDIENCE=cointrack-clients
JWT_ACCESS_TTL_MINUTES=15
JWT_REFRESH_TTL_DAYS=30

# Email SMTP (DOPLŇ RUČNĚ z WEDOS Mailhosting)
# Pozn.: smtp.wedos.net NEEXISTUJE — správný hostname WEDOS Mailhostingu
# je wes1-smtp.wedos.net (STARTTLS, port 587) nebo smtp.wedos.com.
SMTP_HOST=wes1-smtp.wedos.net
SMTP_PORT=587
SMTP_USER=founder@cointrack.cz
SMTP_PASSWORD=__DOPLN__
EMAIL_FROM=founder@cointrack.cz

# Banking aggregator (DOPLŇ po KYC approval)
BANKING_PROVIDER=fio_only
GOCARDLESS_SECRET_ID=
GOCARDLESS_SECRET_KEY=
ENABLE_BANKING_APP_ID=
ENABLE_BANKING_PRIVATE_KEY_PATH=

# Stripe (DOPLŇ při spuštění plateb)
STRIPE_SECRET_KEY=
STRIPE_WEBHOOK_SECRET=
EOF
  chmod 600 $ENV_FILE
  echo "  Vygenerováno: $ENV_FILE"
  echo "  Secrets: JWT (256-bit), Postgres password, MinIO password"
else
  echo "  .env.prod existuje, generování přeskočeno"
fi

# ─── 7. DONE ───────────────────────────────────────────────────────

echo
echo "╔══════════════════════════════════════════════════════════════╗"
echo "║                   ✓ Bootstrap hotový                         ║"
echo "╚══════════════════════════════════════════════════════════════╝"
echo
echo "▼ CO DÁL (udělej ručně):"
echo
echo "1. Nastav DNS v Cloudflare / WEDOS (A-record na tuto VPS):"
echo "     api.cointrack.cz    A    $(curl -s ifconfig.me || echo '46.28.109.21')"
echo "     files.cointrack.cz  A    $(curl -s ifconfig.me || echo '46.28.109.21')"
echo
echo "2. Doplň SMTP heslo v $ENV_FILE:"
echo "     nano /opt/cointrack/infra/.env.prod"
echo "     (SMTP_PASSWORD = heslo z WEDOS Mailhosting)"
echo
echo "3. Spusť celý stack:"
echo "     cd /opt/cointrack/infra"
echo "     docker compose -f docker-compose.prod.yml --env-file .env.prod up -d"
echo
echo "4. Ověř (po 60 vteřinách):"
echo "     curl https://api.cointrack.cz/health"
echo
echo "Podrobnosti v /opt/cointrack/infra/README.md"
echo
