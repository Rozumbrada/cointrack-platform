# Cointrack Platform

Backend API + web (marketing + authed app) pro Cointrack.
Android mobilní aplikace žije v separátním repu: `C:\Users\ai\finance`.

## Moduly

| Složka | Stack | Účel |
|---|---|---|
| `api/` | Kotlin + Ktor + Postgres + MinIO | REST API, auth, sync, GoCardless, Stripe |
| `web/` | Next.js 15 (App Router) | Marketing (SSG) + authed app (CSR) |
| `infra/` | Docker Compose, Nginx, scripts | Deploy konfigurace |
| `scripts/` | Bash | Utility skripty (backup, restore, …) |

## Lokální dev — první start

### Prerekvizity
- Docker Desktop (Windows/Mac) nebo Docker Engine (Linux)
- JDK 21 (doporučeno přes [SDKMAN](https://sdkman.io/) nebo [Adoptium](https://adoptium.net/))
- Node.js 20+ (přes [nvm-windows](https://github.com/coreybutler/nvm-windows))
- Git

### 1. Nakopíruj env

```bash
cp .env.example .env
# otevři .env a doplň/změň si hodnoty (pro dev stačí defaulty)
```

### 2. Spusť závislosti (Postgres + MinIO + Mailhog)

```bash
docker compose -f docker-compose.dev.yml up -d
```

Ověř:
- Postgres: `localhost:5432`, DB `cointrack`, user/pass `cointrack`/`cointrack`
- MinIO konzole: http://localhost:9001 (user/pass `cointrack`/`cointrack123`)
- Mailhog UI: http://localhost:8025

### 3. Spusť API

```bash
cd api
./gradlew run
```

Ověř: http://localhost:8080/health → `{"status":"ok"}`

### 4. Spusť web (až bude scaffolded)

```bash
cd web
npm install
npm run dev
```

Ověř: http://localhost:3000

## Produkční deploy

Viz `infra/README.md` (bude doplněno).

## Branching

- `main` — produkce
- `develop` — staging
- `feat/*` — featury
- `fix/*` — hotfixy

## Kontakty / podpora

- Support: `support@cointrack.cz`
- Status: `status.cointrack.cz`
