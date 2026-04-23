# GoCardless Bank Account Data — setup návod

## Co je to

**GoCardless Bank Account Data** (dříve Nordigen) je PSD2 AIS agregátor.
Používáme ho, abychom mohli číst transakce z bank uživatelů, aniž bychom museli mít vlastní TPP licenci.

- Pokrývá **všechny major české banky**: ČSOB, KB, Česká spořitelna, Air Bank, Raiffeisen, UniCredit, mBank, Equa, Creditas, MONETA, Fio
- Pokrývá 2500+ bank v 31 zemích EU/UK
- Free tier: **50 requestů na endpoint/den/účet** (stačí na 500+ uživatelů)

## Krok 1: Prerekvizity

Musíš mít **registrovanou podnikatelskou entitu v EU/UK**:
- OSVČ (IČO)
- nebo s.r.o. (IČO + DIČ)

Příprava dokumentů (naskenované PDF):
- [ ] Výpis z obchodního rejstříku — stáhni z [justice.cz](https://or.justice.cz/ias/ui/rejstrik)
- [ ] Živnostenský list — z [rzp.cz](https://www.rzp.cz) (pro OSVČ)
- [ ] Doklad totožnosti beneficial owner (občanka oboustranně nebo pas)
- [ ] Proof of address (faktura za energie, bankovní výpis, vše ne starší než 3 měsíce)

## Krok 2: Registrace

1. Jdi na **[https://bankaccountdata.gocardless.com/signup/](https://bankaccountdata.gocardless.com/signup/)**
2. Vyplň:
   - **Business email**: ideálně `founder@cointrack.cz` (po koupi domény a nastavení emailu). Pro start gmail.
   - **Silné heslo** — ulož do password manageru
3. Ověř email
4. V „Company setup":
   - **Company legal name**: přesný název z OR (např. „Tvoje s.r.o." nebo „Jméno Příjmení")
   - **Company registration number**: IČO (8 číslic)
   - **VAT number**: DIČ, pokud jsi plátce DPH
   - **Country**: Czech Republic
   - **Address**: sídlo firmy
   - **Industry**: Technology / Software
5. V „Use case description" napiš:

> **Cointrack is a personal and SME finance management application for the Czech and EU market. We aggregate bank account transaction data via AIS (Account Information Services) for display, categorization, and analytics within our mobile (Android, iOS) and web applications.
>
> End users explicitly authorize each bank connection through the SCA flow in their bank's native interface. We do not initiate payments (no PIS). Users can revoke their consent at any time.
>
> Data is stored encrypted on our EU-based infrastructure (Hetzner/WEDOS in Germany/Czech Republic), subject to GDPR. No third party sharing.
>
> Expected volume: 500-5,000 active end users in the first year, primarily based in Czech Republic and EU.**

6. Upload dokumentů:
   - Výpis z OR → „Company registration document"
   - Občanka/pas → „ID document for beneficial owner"
   - Faktura energií → „Proof of address"
7. Submit

## Krok 3: Sandbox klíče (okamžitě dostupné)

Po registraci, i bez KYC approval, získáš **sandbox credentials**:

1. V dashboardu → **User Secrets**
2. Klikni **Create new** a pojmenuj ho třeba `cointrack-dev-local`
3. Zkopíruj `secret_id` a `secret_key`
4. **OKAMŽITĚ ulož do password manageru** (Bitwarden / 1Password) — sekret se ti znovu nezobrazí
5. Přidej do `.env` lokálního projektu:

```
GOCARDLESS_SECRET_ID=tvuj_secret_id
GOCARDLESS_SECRET_KEY=tvuj_secret_key
```

## Krok 4: Sandbox test (bez čekání na KYC)

V sandboxu jsou **testovací banky** s fake daty:
- `SANDBOXFINANCE_SFIN0000` — obecná testovací banka

Ideální pro vývoj, než přijde KYC approval.

### Rychlý test z terminálu

```bash
# Získej access token
curl -X POST "https://bankaccountdata.gocardless.com/api/v2/token/new/" \
  -H "Content-Type: application/json" \
  -d '{
    "secret_id": "tvuj_secret_id",
    "secret_key": "tvuj_secret_key"
  }'
# vrátí: {"access": "...", "refresh": "...", "access_expires": 86400, ...}

# Ulož si access token
ACCESS="eyJ..."

# Seznam českých bank
curl "https://bankaccountdata.gocardless.com/api/v2/institutions/?country=CZ" \
  -H "Authorization: Bearer $ACCESS"
# vrátí seznam: ČSOB, KB, Fio, Air Bank, ...
```

Pokud tohle funguje, napojení na GoCardless máš živé.

## Krok 5: Čekání na KYC approval

Po odeslání dokumentů GoCardless to zkontroluje:
- **Rychlý scénář**: 1-3 pracovní dny
- **Pomalý scénář**: až 7 pracovních dnů (často když chybí podklady)

Pokud něco chybí, napíší emailem s žádostí o doplnění. **Odpověz do 24h**, jinak to pustí k ledu.

Po approval:
- V dashboardu se přepne z „Sandbox" na „Production"
- Můžeš pracovat s reálnými bankami
- Free tier zůstává stejný (50 req/endpoint/den)

## Krok 6: Až budeš překračovat free tier

- **Premium tier** ~$0,23 / uživatel / měsíc za unlimited requesty
- Kontakt: [sales@gocardless.com](mailto:sales@gocardless.com) nebo přes dashboard
- Aktivuje se instantně po přidání platební karty

## Poznámky k PSD2 limitům

Tyto limity platí pro všechny AIS aggregátory, nemůžeš je obejít:

- **90denní reconsent** — uživatel musí každých 90 dní znovu projít SCA
- **Max 90 dní historie** — u většiny bank. Některé (KB, ČS) povolují víc po samostatné žádosti.
- **Max 4× denně pull** bez uživatelské přítomnosti
- **SCA povinné** — uživatel musí být fyzicky přítomen při první autorizaci

## Užitečné odkazy

- Dokumentace: [https://developer.gocardless.com/bank-account-data/](https://developer.gocardless.com/bank-account-data/)
- API reference: [https://developer.gocardless.com/bank-account-data/endpoints](https://developer.gocardless.com/bank-account-data/endpoints)
- Status: [https://status.gocardless.com/](https://status.gocardless.com/)
- Seznam pokrytých bank: [https://bankaccountdata.gocardless.com/coverage/](https://bankaccountdata.gocardless.com/coverage/)
