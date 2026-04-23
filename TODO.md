# Cointrack — pracovní plán

## ✅ Sprint 1 — Infrastruktura (probíhá)

### Hotovo automaticky
- [x] Monorepo struktura `cointrack-platform/`
- [x] `.gitignore`, `.env.example`, `README.md`
- [x] `docker-compose.dev.yml` — Postgres + MinIO + Mailhog
- [x] Ktor API skeleton (health endpoint funguje)
- [x] Flyway setup + V1 migrace (auth tabulky)
- [x] Dockerfile pro produkční build
- [x] Základní smoke test health endpointu

### Zbývá tobě
- [ ] Koupit `cointrack.cz`, `cointrack.app`, `cointrack.com` (WEDOS / Porkbun)
- [ ] Založit GoCardless Bank Account Data účet + KYC (3-7 dní čekání)
- [ ] Založit Hetzner nebo WEDOS VPS účet
- [ ] Založit Stripe účet (KYC 2-5 dní)
- [ ] Založit GitHub/GitLab repo `cointrack-platform`
- [ ] Push initial commit
- [ ] Otestovat lokální dev (viz README.md)
- [ ] Konfigurace Sentry účet

## ✅ Sprint 2 — Auth + email (hotovo)

- [x] Argon2id password hashing
- [x] Email služba (Mailhog v dev, WEDOS SMTP v prod)
- [x] HTML šablony (verify, password reset)
- [x] JWT access tokeny + refresh rotation
- [x] Endpointy:
  - [x] POST `/api/v1/auth/register`
  - [x] POST `/api/v1/auth/login`
  - [x] POST `/api/v1/auth/logout`
  - [x] POST `/api/v1/auth/refresh`
  - [x] GET  `/api/v1/auth/me` (JWT protected)
  - [x] POST `/api/v1/auth/verify-email`
  - [x] POST `/api/v1/auth/forgot-password`
  - [x] POST `/api/v1/auth/reset-password`
- [x] Integration testy přes Zonky Embedded Postgres (Docker-less)
- [ ] Google OAuth (odloženo na Sprint 2.5)

## ✅ Sprint 3 — Marketing web (hotovo, čeká na `npm install` + deploy)

- [x] Next.js 15 App Router scaffolding
- [x] Tailwind + brand paleta + shadcn-style komponenty
- [x] Marketing stránky:
  - [x] Homepage (hero, features grid, how-it-works, CTA)
  - [x] /features (10 detailních sekcí)
  - [x] /pricing (4 tiery + FAQ)
  - [x] /for-business (pro OSVČ, business focuses, integrace)
  - [x] /about
  - [x] /contact
  - [x] /privacy (GDPR Privacy Policy draft)
  - [x] /terms (Terms of Service draft)
- [x] Auth UI: /login, /signup, /forgot, /reset?token=
- [x] Sitemap.xml + robots.txt (Next.js auto-gen)
- [x] Favicon + OG metadata
- [x] API client wrapper (`src/lib/api.ts`) napojený na Ktor backend
- [ ] `npm install` + lokální test (potřebuje Node)
- [ ] Screenshots pro features stránku
- [ ] OG image (1200×630)
- [ ] Plausible Analytics script
- [ ] Deploy na Vercel

## ✅ Sprint 4 — Sync API (hotovo, testy procházejí)

- [x] V2 migrace: profiles, accounts, categories, transactions, receipts, invoices + items + files metadata
- [x] Sync pattern: `sync_id` (stabilní napříč zařízeními), `updated_at`, `deleted_at`, `client_version`
- [x] GET `/api/v1/sync?since=<iso>` — vrátí entity upravené po timestampu
- [x] POST `/api/v1/sync` — batch push s LWW conflict resolution
- [x] Server-side translation sync_id ↔ db_id pro foreign keys (účty, kategorie, ...)
- [x] POST `/api/v1/files/upload-url` — presigned S3/MinIO URL pro upload
- [x] GET  `/api/v1/files/download-url?key=...` — presigned URL pro download
- [x] AWS SDK v2 s URL connection HTTP (light)
- [x] Integration testy: register+login+profile push/pull, chain profile→account→category→transaction, LWW conflict, `since` filter
- [ ] V3 migrace: warranties, loyalty_cards, budgets, debts, goals, planned_payments, shopping_lists (pattern je stejný, přidá se v budoucnu)

## Sprint 5a — Android cloud infrastructure (hotovo)

- [x] Retrofit CloudApiService + modely (auth, sync, files)
- [x] CloudTokenManager (EncryptedSharedPreferences pro access + refresh)
- [x] AuthInterceptor + CloudAuthenticator (auto-refresh přes 401)
- [x] CloudModule (Hilt DI s vlastním OkHttp pipeline)
- [x] CloudAuthRepository (register, login, logout, forgot, reset, me, refresh)
- [x] CloudViewModel + CloudUiState
- [x] UI: CloudLoginScreen, CloudSignupScreen, CloudSettingsScreen (CZ + EN)
- [x] Napojení na NavGraph + Drawer menu
- [x] v15.64 APK built

## ✅ Sprint 5b — Cloud sync infrastruktura (hotovo)

- [x] **DB migrace 21 → 22**: `syncId: String`, `updatedAt: Long`, `deletedAt: Long?`, `clientVersion: Long` přidáno do 8 core tabulek (profiles, accounts, categories, transactions, receipts, receipt_items, invoices, invoice_items)
- [x] Migrace vygeneruje UUID pro všechny existující řádky + nastaví `updatedAt = now`
- [x] UNIQUE index na `syncId` pro každou tabulku
- [x] `Syncable` interface + helpers `newSyncId()`, `nowMs()`
- [x] 8 entity data classes rozšířeno o sync pole + implementují `Syncable`
- [x] `SyncMappers` — bidirectional JSON konverze pro 6 core entit (Profile, Account, Category, Transaction, Receipt+Item, Invoice+Item)
- [x] `CloudSyncRepository` skeleton s `syncNow()` smoke testem (volá `/me`, validuje JWT)
- [x] `CloudViewModel.syncNow()` + `SyncState` flow (Running/Done/Failed)
- [x] UI: tlačítko „Synchronizovat teď" aktivní v CloudSettingsScreen — loading / success / error feedback
- [x] v15.67 APK built, 0 chyb, Room KSP OK

## Sprint 5c — Data sync loop (po Sprint 6 deploy)

- [ ] Rozšířit `CloudSyncRepository.syncNow()`:
  - [ ] **Pull**: GET /sync?since=<last> → aplikovat entity do Room přes `syncId` lookup
  - [ ] **Push**: vybrat entity `WHERE updatedAt > lastPushAt`, serializovat do `SyncPushRequest`
  - [ ] **Conflict resolution**: server wins (LWW), klient refetch pokud je rozdíl
- [ ] DAO metody: `getAllForSync(since)`, `getBySyncId(id)`, `upsertFromSync(entity)` pro 6 entit
- [ ] `settings.lastSyncTimestamp` v DataStore
- [ ] Periodic `SyncWorker` (WorkManager, hourly + on-demand)
- [ ] MinIO file upload: fotky účtenek + PDF faktur přes presigned URL
- [ ] Entitlement feature gating (Free/Cloud/Business/Pro)
- [ ] Migrace z Drive backup → cloud sync (Drive zůstane jako záloha)

## Sprint 6 — GoCardless

- [ ] DB schema: bank_institutions, bank_consents, bank_accounts, bank_sync_jobs
- [ ] Endpointy /api/v1/banking/*
- [ ] BankSyncWorker (cron 2× denně)
- [ ] Mapování GC transakce → domácí model
- [ ] Webhooks + reconsent notifikace
- [ ] UI v Android appce + web

## Sprint 7 — Authed web app

- [ ] Login / signup stránky
- [ ] Dashboard
- [ ] Transactions
- [ ] Invoices upload + detail
- [ ] Receipts upload + detail
- [ ] Banking UI
- [ ] Settings

## Sprint 8 — Stripe + entitlements

- [ ] Stripe produkty: Cloud / Business / Pro (monthly + yearly)
- [ ] Checkout + Customer Portal
- [ ] Webhook handler
- [ ] Entitlements služba + gating
- [ ] /app/settings/billing

## Sprint 9 — Beta launch

- [ ] Legal review (Privacy, ToS, DPA)
- [ ] Sentry alerts
- [ ] Uptime Kuma + status page
- [ ] Backup verification
- [ ] Rate limiting
- [ ] Cloudflare WAF
- [ ] 10-20 beta testerů
- [ ] Support email + FAQ
