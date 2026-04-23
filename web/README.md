# Cointrack Web

Next.js 15 App Router — marketing (SSG) + authed app (CSR, coming in Sprint 7).

## Start (prerekvizita: Node.js 20+)

```bash
# Pokud nemáš Node: v PowerShell
scoop install nodejs-lts

# Instalace závislostí (jednorázově)
cd web
npm install

# Dev server
npm run dev
```

Otevři **http://localhost:3000**.

## Stránky

### Marketing (SSG, veřejné)

| Cesta | Co to je |
|---|---|
| `/` | Homepage — hero, features, CTA |
| `/features` | Detailní popis funkcí |
| `/pricing` | Ceník 4 tierů + FAQ |
| `/for-business` | Pro OSVČ a firmy |
| `/about` | O projektu |
| `/contact` | Kontakt |
| `/privacy` | GDPR Privacy Policy |
| `/terms` | Smluvní podmínky |
| `/sitemap.xml` | Auto-gen sitemap |
| `/robots.txt` | Auto-gen robots |

### Auth (CSR, volá API)

| Cesta | Funkce |
|---|---|
| `/login` | Přihlášení |
| `/signup` | Registrace |
| `/forgot` | Zapomenuté heslo |
| `/reset?token=...` | Nastavení nového hesla |

### App (CSR, chráněné) — Sprint 7

| Cesta | Funkce |
|---|---|
| `/app/dashboard` | Dashboard |
| `/app/transactions` | Transakce |
| `/app/invoices` | Faktury |
| `/app/receipts` | Účtenky |
| `/app/banking` | Napojení bank |
| `/app/settings` | Nastavení |

## Env proměnné

V `web/.env.local` (není v gitu):

```
NEXT_PUBLIC_API_URL=http://localhost:8080
```

Pro produkci na Vercel se nastaví přes dashboard → Settings → Environment Variables:

```
NEXT_PUBLIC_API_URL=https://api.cointrack.cz
```

## Styling

- **Tailwind CSS** — utility classes
- **Brand barvy**: `brand-600` (orange #ea580c) + `ink-*` (warm gray)
- **Font**: system font stack (rychlé načítání, žádné externí fonty)
- **Ikony**: `lucide-react`

## Deploy (Vercel)

```bash
# Jednorázově
npx vercel link

# Deploy preview
npx vercel

# Deploy produkce
npx vercel --prod
```

Nebo propojit GitHub repo s Vercelem — každý push na `main` = auto deploy.

## Struktura

```
web/
├── public/
│   └── favicon.svg
├── src/
│   ├── app/
│   │   ├── layout.tsx              ← root layout
│   │   ├── globals.css
│   │   ├── sitemap.ts
│   │   ├── robots.ts
│   │   ├── (marketing)/            ← SSG grupa
│   │   │   ├── layout.tsx          ← Navbar + Footer
│   │   │   ├── page.tsx            ← homepage
│   │   │   ├── features/page.tsx
│   │   │   ├── pricing/page.tsx
│   │   │   ├── for-business/page.tsx
│   │   │   ├── about/page.tsx
│   │   │   ├── contact/page.tsx
│   │   │   ├── privacy/page.tsx
│   │   │   └── terms/page.tsx
│   │   └── (auth)/                 ← Auth grupa
│   │       ├── layout.tsx
│   │       ├── login/page.tsx
│   │       ├── signup/page.tsx
│   │       ├── forgot/page.tsx
│   │       └── reset/page.tsx
│   ├── components/
│   │   ├── marketing/
│   │   │   ├── Logo.tsx
│   │   │   ├── Navbar.tsx
│   │   │   └── Footer.tsx
│   │   └── ui/
│   │       ├── button.tsx
│   │       └── container.tsx
│   └── lib/
│       ├── api.ts                  ← fetch wrapper
│       └── utils.ts                ← cn, SITE config
├── next.config.ts
├── tailwind.config.ts
├── tsconfig.json
├── postcss.config.mjs
├── package.json
└── README.md
```

## Co chybí / TODO

- [ ] Favicon.ico + PWA manifest
- [ ] OpenGraph image (1200×630 PNG)
- [ ] Screenshots pro Features stránku
- [ ] /cookies stránka (dočasně redirect → /privacy)
- [ ] /download stránka s Play Store badgem
- [ ] Plausible Analytics script
- [ ] Žluté / červené barvy pro error/success stavy v design systemu
- [ ] Rate limiting na auth endpointech (backend)
- [ ] httpOnly session cookies místo localStorage
