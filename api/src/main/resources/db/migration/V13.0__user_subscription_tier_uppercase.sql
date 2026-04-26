-- V13.0 — Normalizace hodnot users.tier na uppercase enum (FREE/PERSONAL/BUSINESS/ORGANIZATION).
--
-- Důvod: mobil i web mají SubscriptionTier enum s hodnotami FREE, PERSONAL, BUSINESS, ORGANIZATION.
-- Doposud DB ukládala lowercase ('free', případně další). Sjednocujeme na uppercase enum names.

-- 1) Normalizace existujících hodnot
UPDATE users SET tier = 'FREE'         WHERE tier IS NULL OR LOWER(tier) IN ('free', '');
UPDATE users SET tier = 'PERSONAL'     WHERE LOWER(tier) = 'personal';
UPDATE users SET tier = 'BUSINESS'     WHERE LOWER(tier) IN ('business', 'pro');
UPDATE users SET tier = 'ORGANIZATION' WHERE LOWER(tier) IN ('organization', 'organisation', 'enterprise', 'b2b');

-- 2) Default sloupce: 'free' → 'FREE'
ALTER TABLE users ALTER COLUMN tier SET DEFAULT 'FREE';

-- 3) Konkrétní uživatelé — zákazníci na Organization tieru.
--    Pokud email v DB není, řádky se prostě neaktualizují (no-op).
UPDATE users
   SET tier = 'ORGANIZATION', updated_at = now()
 WHERE LOWER(email) IN ('jenikdrdla@gmail.com', 'martdrdla@gmail.com');
