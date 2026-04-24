-- V9.0 Banking (Sprint 6): Salt Edge + abstraktní banking provider
--
-- Model:
--   bank_customers      — 1:1 s user, drží customer_id v externím provideru
--   bank_connections    — jedna banka/login per řádek, consent lifecycle
--   bank_accounts_ext   — účet v bance (může být víc pod jedním connection)
--   bank_transactions_ext — transakce (raw, dedup přes external_id)
--   bank_webhook_events — raw log eventů od provider-a, pro debug + replay

CREATE TABLE bank_customers (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    provider        VARCHAR(32) NOT NULL,         -- 'saltedge' | 'gocardless' | ...
    external_id     VARCHAR(128) NOT NULL,        -- Salt Edge customer.id
    created_at      TIMESTAMP NOT NULL DEFAULT NOW(),
    UNIQUE (user_id, provider)
);

CREATE INDEX idx_bank_customers_external ON bank_customers(provider, external_id);

CREATE TABLE bank_connections (
    id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    customer_id          UUID NOT NULL REFERENCES bank_customers(id) ON DELETE CASCADE,
    provider             VARCHAR(32) NOT NULL,
    external_id          VARCHAR(128) NOT NULL,    -- Salt Edge connection.id
    provider_code        VARCHAR(128),             -- banka: 'fakebank_simple_xf' atd.
    provider_name        VARCHAR(256),             -- UI label: "Fakebank Simulator"
    status               VARCHAR(32) NOT NULL,     -- active | inactive | disabled | error
    last_success_at      TIMESTAMP,                -- poslední úspěšný refresh
    consent_expires_at   TIMESTAMP,                -- kdy musí uživatel obnovit souhlas
    last_error           TEXT,                     -- zpráva z posledního erroru
    created_at           TIMESTAMP NOT NULL DEFAULT NOW(),
    updated_at           TIMESTAMP NOT NULL DEFAULT NOW(),
    deleted_at           TIMESTAMP,
    UNIQUE (provider, external_id)
);

CREATE INDEX idx_bank_connections_customer ON bank_connections(customer_id);
CREATE INDEX idx_bank_connections_status ON bank_connections(status) WHERE deleted_at IS NULL;

CREATE TABLE bank_accounts_ext (
    id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    connection_id    UUID NOT NULL REFERENCES bank_connections(id) ON DELETE CASCADE,
    external_id      VARCHAR(128) NOT NULL,        -- Salt Edge account.id
    name             VARCHAR(256),                 -- "Běžný účet 123456789/0800"
    nature           VARCHAR(32),                  -- account|card|loan|savings|credit|...
    currency_code    VARCHAR(8) NOT NULL,
    iban             VARCHAR(34),
    account_number   VARCHAR(64),                  -- raw číslo účtu + kód
    balance          NUMERIC(18,4),                -- poslední známý zůstatek
    balance_updated_at TIMESTAMP,
    raw              JSONB,                        -- kompletní provider payload
    created_at       TIMESTAMP NOT NULL DEFAULT NOW(),
    updated_at       TIMESTAMP NOT NULL DEFAULT NOW(),
    deleted_at       TIMESTAMP,
    UNIQUE (connection_id, external_id)
);

CREATE INDEX idx_bank_accounts_ext_connection ON bank_accounts_ext(connection_id);

CREATE TABLE bank_transactions_ext (
    id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    account_ext_id     UUID NOT NULL REFERENCES bank_accounts_ext(id) ON DELETE CASCADE,
    external_id        VARCHAR(128) NOT NULL,     -- Salt Edge transaction.id
    amount             NUMERIC(18,4) NOT NULL,    -- záporné = výdaj, kladné = příjem
    currency_code      VARCHAR(8) NOT NULL,
    description        TEXT,
    category_hint      VARCHAR(64),               -- provider-navrhovaná kategorie
    made_on            DATE NOT NULL,
    merchant_name      VARCHAR(256),
    extra              JSONB,                     -- VS/KS/SS, protiúčet, bic, …
    status             VARCHAR(32) NOT NULL DEFAULT 'posted', -- posted | pending
    raw                JSONB,                     -- plný provider payload
    created_at         TIMESTAMP NOT NULL DEFAULT NOW(),
    UNIQUE (account_ext_id, external_id)
);

CREATE INDEX idx_bank_transactions_ext_account_date ON bank_transactions_ext(account_ext_id, made_on DESC);

CREATE TABLE bank_webhook_events (
    id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    provider           VARCHAR(32) NOT NULL,
    event_type         VARCHAR(64) NOT NULL,      -- 'success'|'fail'|'destroy'|'notify'|...
    external_connection_id VARCHAR(128),
    payload            JSONB NOT NULL,
    signature          TEXT,                      -- raw Signature header (pro audit)
    received_at        TIMESTAMP NOT NULL DEFAULT NOW(),
    processed_at       TIMESTAMP,
    error              TEXT
);

CREATE INDEX idx_bank_webhook_events_unprocessed
    ON bank_webhook_events(received_at) WHERE processed_at IS NULL;
