# Lokální dev — rychlý start

## Prerekvizity (jednorázově)

### 1. Docker Desktop

Stáhni a nainstaluj [Docker Desktop](https://www.docker.com/products/docker-desktop/).
Ověř: `docker --version` → `Docker version 24.x` nebo novější.

### 2. JDK 21

Nejjednodušeji přes [Adoptium Temurin](https://adoptium.net/temurin/releases/?version=21).
Ověř: `java -version` → `openjdk version "21.x"`.

### 3. Git

Pokud ještě nemáš, [https://git-scm.com/download/win](https://git-scm.com/download/win).

## První spuštění

### Krok 1: Zkopíruj env

```bash
cd /c/Users/ai/cointrack-platform
cp .env.example .env
```

Default hodnoty v `.env` fungují pro lokální dev, nic nemusíš měnit.

### Krok 2: Spusť závislosti

```bash
docker compose -f docker-compose.dev.yml up -d
```

Počkej ~30 sekund. Pak ověř:

```bash
docker compose -f docker-compose.dev.yml ps
```

Všechny 3 služby musí být `running (healthy)`:
- `cointrack-postgres`
- `cointrack-minio`
- `cointrack-mailhog`

### Krok 3: Web konzole (ověř, že vše jede)

Otevři v prohlížeči:
- **MinIO**: [http://localhost:9001](http://localhost:9001) → login `cointrack` / `cointrack123`
- **Mailhog**: [http://localhost:8025](http://localhost:8025) → zde uvidíš všechny odeslané maily z aplikace
- **Postgres**: pokud máš pgAdmin / DBeaver, připoj se na `localhost:5432`, DB `cointrack`, user/pass `cointrack`/`cointrack`

### Krok 4: Spusť Ktor API

```bash
cd api
./gradlew run
```

První build trvá 2-3 minuty (stahuje dependency). Pak uvidíš:

```
INFO  Application - Responding at http://0.0.0.0:8080
```

### Krok 5: Test endpointu

V druhém terminálu:

```bash
curl http://localhost:8080/health
# { "status": "ok", "version": "0.1.0", "environment": "dev", "timestamp": "..." }
```

**Když tohle funguje, máš fungující dev prostředí. 🎉**

## Běžné problémy

### Port 5432 / 8080 / 9000 je obsazený
Zastav službu, co ho používá, nebo změň port v `docker-compose.dev.yml` / `application.yaml`.

### Gradle build selhává
- Ověř JDK 21: `java -version`
- Smaž cache: `./gradlew --stop && rm -rf ~/.gradle/caches`
- Zkus znova: `./gradlew run --no-build-cache`

### Postgres connection refused
```bash
docker compose -f docker-compose.dev.yml logs postgres
```

### Flyway migrace selhala
Smaž DB a spusť znova:
```bash
docker compose -f docker-compose.dev.yml down -v
docker compose -f docker-compose.dev.yml up -d
```
**Pozor**: `-v` smaže data. Neděj to v produkci.

## Zastavení

```bash
docker compose -f docker-compose.dev.yml stop
```

Pro úplné smazání včetně dat:
```bash
docker compose -f docker-compose.dev.yml down -v
```

## Next steps po prvním úspěšném spuštění

1. První commit do Gitu:
   ```bash
   cd /c/Users/ai/cointrack-platform
   git init
   git add .
   git commit -m "feat: initial cointrack platform scaffold"
   ```

2. Založ GitHub repo a push:
   ```bash
   gh repo create cointrack-platform --private --source=. --push
   ```
   (Nebo přes [github.com/new](https://github.com/new))

3. Pokračuj podle `TODO.md` → Sprint 2: Auth endpoints.
