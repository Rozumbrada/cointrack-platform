# Cointrack Auth API — reference

Base URL (dev): `http://localhost:8080/api/v1`

Všechny endpointy vrací JSON, přijímají JSON. Content-Type: `application/json`.

## Token model

- **Access JWT**: krátký (15 min), nosí se v `Authorization: Bearer <token>` headeru
- **Refresh token**: dlouhý (30 dní), opaque, po každém použití se invaliduje a vydá nový (rotation)

## Endpointy

### POST `/auth/register`

Registrace novým emailem.

```json
{
  "email": "jan@example.com",
  "password": "MinAspoň8Znaků",
  "displayName": "Jan Novák",    // optional
  "locale": "cs"                 // optional, default "cs"
}
```

**201 Created**:
```json
{
  "id": "uuid",
  "email": "jan@example.com",
  "displayName": "Jan Novák",
  "locale": "cs",
  "tier": "free",
  "emailVerified": false
}
```

**409 Conflict** (`email_taken`) — email už existuje
**400 Bad Request** (`weak_password`, `invalid_email`) — validace

Automaticky odešle verifikační email.

---

### POST `/auth/login`

```json
{
  "email": "jan@example.com",
  "password": "MinAspoň8Znaků",
  "deviceId": "android-pixel-8"  // optional
}
```

**200 OK**:
```json
{
  "accessToken": "eyJhbGc...",
  "refreshToken": "opaque-random-string",
  "expiresIn": 900,
  "user": { ... UserDto ... }
}
```

**401** (`invalid_credentials`) — špatné heslo nebo email

---

### POST `/auth/refresh`

```json
{ "refreshToken": "..." }
```

**200 OK**: stejný tvar jako login. Starý refresh token se invaliduje.

**401** (`invalid_refresh` | `revoked_refresh` | `expired_refresh`)

---

### POST `/auth/logout`

```json
{ "refreshToken": "..." }
```

Revokuje refresh token. Access token dožije sám (15 min).

**200 OK**: `{"message": "logged_out"}`

---

### GET `/auth/me` 🔒

Vyžaduje `Authorization: Bearer <accessToken>`.

**200 OK**: UserDto.
**401** pokud token chybí/neplatný.

---

### POST `/auth/verify-email`

```json
{ "token": "..." }
```

Klient web app vezme `?token=...` z URL a zavolá sem.

**200 OK**: `{"message": "email_verified"}`
**400** (`invalid_token`, `expired`, `already_used`)

---

### POST `/auth/forgot-password`

```json
{ "email": "jan@example.com" }
```

**200 OK**: vždy — neprozrazujeme, jestli email v DB je.
Pokud existuje, pošle email s reset linkem.

---

### POST `/auth/reset-password`

```json
{
  "token": "...",
  "newPassword": "NovéHeslo123"
}
```

**200 OK**: `{"message": "password_updated"}`
Po úspěchu revokuje **všechny** existující refresh tokeny (force re-login everywhere).

---

## Manuální test (curl)

```bash
# Register
curl -X POST http://localhost:8080/api/v1/auth/register \
  -H "Content-Type: application/json" \
  -d '{"email":"test@example.com","password":"Heslo123456"}'

# Login
curl -X POST http://localhost:8080/api/v1/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"test@example.com","password":"Heslo123456"}'

# Ulož si access_token z response
ACCESS="eyJ..."

# Me
curl http://localhost:8080/api/v1/auth/me \
  -H "Authorization: Bearer $ACCESS"
```

## Ověření emailu při testu lokálně

Mailhog zachycuje všechny odchozí emaily:
- Otevři http://localhost:8025
- Najdi verifikační email
- V odkazu je `?token=...`
- Pošli POST na `/auth/verify-email` s tím tokenem

## Chybový formát

Všechny chyby vrací:
```json
{
  "error": "strukturovaný_kód",
  "message": "Lidsky čitelná zpráva v češtině.",
  "requestId": "uuid"
}
```
