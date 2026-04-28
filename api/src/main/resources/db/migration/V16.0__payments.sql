-- V16.0 — Tabulka pro QR-based payments (bez Stripe).
--
-- Tok:
--  1. User klikne "Upgrade" → vytvoří se PENDING záznam s unique VS.
--  2. Frontend ukáže QR (SPAYD) + pokyny k bankovnímu převodu.
--  3. Buď admin manuálně mark-paid, nebo Fio worker matchne příchozí převod
--     dle VS + amount → status=PAID, users.tier upgraded, expires_at set.

CREATE TABLE payments (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    tier            VARCHAR(16) NOT NULL,           -- PERSONAL / BUSINESS / ORGANIZATION
    period          VARCHAR(8) NOT NULL,            -- MONTHLY / YEARLY
    amount          NUMERIC(10,2) NOT NULL,
    currency        VARCHAR(3) NOT NULL DEFAULT 'CZK',
    variable_symbol VARCHAR(10) NOT NULL UNIQUE,    -- 1-10 číslic, bankovní limit
    iban            VARCHAR(64) NOT NULL,           -- náš firemní účet (kde čekáme platbu)
    bank_account    VARCHAR(40),                    -- "2601115347/2010" pro display
    status          VARCHAR(16) NOT NULL DEFAULT 'PENDING',  -- PENDING / PAID / EXPIRED / CANCELLED
    company_name    VARCHAR(256),                   -- billing details (volitelné, jen pro fakturu)
    company_ico     VARCHAR(16),
    company_dic     VARCHAR(32),
    company_address VARCHAR(512),
    customer_email  VARCHAR(255),
    note            TEXT,
    idoklad_invoice_id VARCHAR(64),                 -- až bude vystavena
    invoice_pdf_key VARCHAR(256),                   -- MinIO storage key pro PDF
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    expires_at      TIMESTAMPTZ NOT NULL,           -- platnost QR (typicky 7 dní)
    paid_at         TIMESTAMPTZ,
    matched_tx_id   VARCHAR(64),                    -- Fio transactionId po automatickém matchnutí
    email_sent_at   TIMESTAMPTZ
);

CREATE INDEX idx_payments_user_id ON payments(user_id);
CREATE INDEX idx_payments_status ON payments(status);
CREATE INDEX idx_payments_vs ON payments(variable_symbol);

-- Subscription expiration na users — kdy vyprší aktuální tier (z poslední úspěšné platby)
ALTER TABLE users ADD COLUMN tier_expires_at TIMESTAMPTZ;
