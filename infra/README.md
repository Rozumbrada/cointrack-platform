# Cointrack Production Deploy

Krok-za-krokem návod pro nasazení Cointrack backendu na WEDOS VPS.

## Architektura

```
Internet → Caddy :443 (auto SSL)
                ├── api.cointrack.cz   → Ktor :8080
                └── files.cointrack.cz → MinIO :9000

Postgres :5432 (internal network, bez internetu)
```

Všechny služby běží v Dockeru, orchestrované `docker-compose.prod.yml`.

## Prerekvizity

- WEDOS VPS s Ubuntu 24.04 LTS
- DNS A-records míří na IP VPS:
  - `api.cointrack.cz  → <VPS IP>`
  - `files.cointrack.cz → <VPS IP>`
- SMTP credentials z WEDOS Mailhostingu (pro odchozí emaily)

---

## 1. SSH na VPS

```bash
ssh root@46.28.109.21
```

(nebo `ssh root@<tvoje-VPS-IP>` podle toho, co ti WEDOS poslal)

## 2. Bootstrap — automatická instalace

Jeden příkaz nainstaluje všechno:

```bash
curl -fsSL https://raw.githubusercontent.com/Rozumbrada/cointrack-platform/main/infra/bootstrap.sh | bash
```

Co skript udělá (~2-3 minuty):
- Zaktualizuje systém, nainstaluje základní utility
- UFW firewall (allow 22, 80, 443)
- fail2ban (brute-force ochrana SSH)
- Docker + Docker Compose plugin
- Naklonuje repo do `/opt/cointrack`
- Vygeneruje `.env.prod` s náhodnými secrets (JWT, Postgres heslo, MinIO heslo)

Na konci ti skript vypíše, co ještě dodělat.

## 3. Nastav DNS (pokud ještě nemáš)

### Cloudflare (doporučeno)
1. Přidej doménu `cointrack.cz` do Cloudflare
2. Změň nameservery ve WEDOS na ty od Cloudflare
3. V Cloudflare DNS přidej:

| Type | Name | Content | Proxy |
|------|------|---------|-------|
| A    | api  | 46.28.109.21 | 🟠 Proxied (orange cloud) |
| A    | files | 46.28.109.21 | 🟠 Proxied |
| CNAME| @    | cname.vercel-dns.com | 🟠 Proxied |
| CNAME| www  | cname.vercel-dns.com | 🟠 Proxied |

**Důležité**: u `api` a `files` nech **proxied (oranžový mrak)** — Cloudflare ti dá DDoS ochranu zdarma.

### Nebo WEDOS DNS (bez Cloudflare)
WEDOS panel → Domény → `cointrack.cz` → DNS → Přidat:

| Typ | Název | Hodnota |
|-----|-------|---------|
| A   | api   | 46.28.109.21 |
| A   | files | 46.28.109.21 |

Pro `cointrack.cz` přesměrování na Vercel už by mělo být nastaveno.

## 4. Doplň SMTP heslo

```bash
nano /opt/cointrack/infra/.env.prod
```

Najdi řádek `SMTP_PASSWORD=__DOPLN__` a nahraď vlastním heslem z WEDOS Mailhostingu.

Zkontroluj ostatní SMTP hodnoty:
- `SMTP_HOST=smtp.wedos.net` (typické)
- `SMTP_PORT=587`
- `SMTP_USER=founder@cointrack.cz` (tvůj Mailhosting email)

Uložit: **Ctrl+O, Enter, Ctrl+X**.

## 5. Spuštění stacku

```bash
cd /opt/cointrack/infra
docker compose -f docker-compose.prod.yml --env-file .env.prod up -d
```

První start trvá 3-5 minut (build Ktor image). Další starty ~20 sekund.

Sleduj logy:
```bash
docker compose -f docker-compose.prod.yml logs -f
```

## 6. Ověř, že to jede

### Přímo na VPS
```bash
# Health z vnitřní sítě (bez Caddy)
docker compose -f docker-compose.prod.yml exec api wget -qO- http://localhost:8080/health

# Přes Caddy (externí, může chvíli trvat, než Let's Encrypt vydá cert)
curl https://api.cointrack.cz/health
```

### Z venku (tvůj počítač)
```bash
curl https://api.cointrack.cz/health
```

Očekávaná odpověď:
```json
{"status":"ok","version":"0.1.0","environment":"production","timestamp":"2026-04-23T17:00:00Z"}
```

### Test registrace
```bash
curl -X POST https://api.cointrack.cz/api/v1/auth/register \
  -H "Content-Type: application/json" \
  -d '{"email":"test@example.com","password":"HeslolKTere12"}'
```

Mělo by:
- ✅ Vrátit 201 s UserDto
- ✅ Do gmailu nebo webmailu na `test@example.com` přijít verifikační email

---

## Provozní příkazy

```bash
# Restart
docker compose -f docker-compose.prod.yml restart

# Stop
docker compose -f docker-compose.prod.yml down

# Update (po git push na main)
cd /opt/cointrack && git pull
docker compose -f infra/docker-compose.prod.yml --env-file infra/.env.prod up -d --build api

# Logy konkrétní služby
docker compose -f docker-compose.prod.yml logs -f api
docker compose -f docker-compose.prod.yml logs -f postgres
docker compose -f docker-compose.prod.yml logs -f caddy

# Status všech služeb
docker compose -f docker-compose.prod.yml ps

# Shell v API kontejneru
docker compose -f docker-compose.prod.yml exec api sh

# Postgres shell
docker compose -f docker-compose.prod.yml exec postgres psql -U cointrack -d cointrack
```

## Zálohy

**Nejsou automatické zatím.** Pro beta fázi stačí manuální dump:

```bash
docker compose -f docker-compose.prod.yml exec postgres \
  pg_dump -U cointrack cointrack > ~/cointrack-backup-$(date +%F).sql
```

Plán na automatické zálohy (pgBackRest → Backblaze B2) přidáme v dalším kroku.

## Troubleshooting

### „SSL certificate problem" při curlu
Caddy ještě nestihl vydat cert. Počkej 2-5 minut, zkus znovu.

Zkontroluj Caddy logy:
```bash
docker compose -f docker-compose.prod.yml logs caddy | grep -i cert
```

### „Connection refused" na portu 80/443
Ujisti se, že UFW povolí porty:
```bash
ufw status
# mělo by ukazovat: 80/tcp ALLOW, 443/tcp ALLOW
```

### Postgres migrace selhala
```bash
# Zobraz logy
docker compose -f docker-compose.prod.yml logs api | grep -i flyway

# Reset DB (POZOR: smaže data)
docker compose -f docker-compose.prod.yml down -v
docker compose -f docker-compose.prod.yml up -d
```

### API se nepřipojí k Postgres
```bash
# Ověř síť
docker compose -f docker-compose.prod.yml exec api ping postgres

# Ověř credentials
docker compose -f docker-compose.prod.yml exec postgres psql -U cointrack -d cointrack -c "SELECT 1"
```

---

## Security checklist

- [x] SSH key-only auth (WEDOS default)
- [x] UFW firewall (jen 22, 80, 443)
- [x] fail2ban proti brute-force
- [x] Postgres + MinIO v internal network (nejsou veřejně dostupné)
- [x] TLS 1.3 všude přes Caddy
- [x] HSTS headers
- [x] JWT secret 256-bit, generovaný `openssl rand -hex 32`
- [x] Argon2id password hashing (na API straně)
- [ ] Postgres dumps zálohované mimo VPS (přidáme v další iteraci)
- [ ] Monitoring (Sentry + Uptime Kuma, další iterace)
