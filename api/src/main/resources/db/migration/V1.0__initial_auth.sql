-- Cointrack initial schema: auth + session management
-- Tato migrace vytvoří základní tabulky pro uživatele a autentizaci.

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ─── Users ──────────────────────────────────────────────────────────
CREATE TABLE users (
    id                UUID            PRIMARY KEY DEFAULT gen_random_uuid(),
    email             VARCHAR(255)    NOT NULL UNIQUE,
    email_verified_at TIMESTAMPTZ     NULL,
    password_hash     VARCHAR(255)    NULL,        -- NULL pro OAuth-only účty
    display_name      VARCHAR(128)    NULL,
    locale            VARCHAR(8)      NOT NULL DEFAULT 'cs',
    tier              VARCHAR(32)     NOT NULL DEFAULT 'free',
    created_at        TIMESTAMPTZ     NOT NULL DEFAULT now(),
    updated_at        TIMESTAMPTZ     NOT NULL DEFAULT now(),
    deleted_at        TIMESTAMPTZ     NULL
);

CREATE INDEX idx_users_email ON users (LOWER(email)) WHERE deleted_at IS NULL;

-- ─── OAuth Accounts ─────────────────────────────────────────────────
CREATE TABLE oauth_accounts (
    id                UUID            PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id           UUID            NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    provider          VARCHAR(32)     NOT NULL,    -- google | apple
    provider_user_id  VARCHAR(255)    NOT NULL,
    created_at        TIMESTAMPTZ     NOT NULL DEFAULT now(),
    UNIQUE (provider, provider_user_id)
);

CREATE INDEX idx_oauth_accounts_user ON oauth_accounts (user_id);

-- ─── Sessions (pro web) ─────────────────────────────────────────────
CREATE TABLE sessions (
    id                UUID            PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id           UUID            NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token_hash        VARCHAR(128)    NOT NULL UNIQUE,
    user_agent        TEXT            NULL,
    ip                INET            NULL,
    expires_at        TIMESTAMPTZ     NOT NULL,
    created_at        TIMESTAMPTZ     NOT NULL DEFAULT now(),
    last_used_at      TIMESTAMPTZ     NOT NULL DEFAULT now()
);

CREATE INDEX idx_sessions_user ON sessions (user_id);
CREATE INDEX idx_sessions_expires ON sessions (expires_at);

-- ─── Refresh Tokens (pro mobilní klienty) ───────────────────────────
CREATE TABLE refresh_tokens (
    id                UUID            PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id           UUID            NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token_hash        VARCHAR(128)    NOT NULL UNIQUE,
    device_id         VARCHAR(255)    NULL,
    expires_at        TIMESTAMPTZ     NOT NULL,
    revoked_at        TIMESTAMPTZ     NULL,
    created_at        TIMESTAMPTZ     NOT NULL DEFAULT now()
);

CREATE INDEX idx_refresh_tokens_user ON refresh_tokens (user_id);

-- ─── Email Verifications ────────────────────────────────────────────
CREATE TABLE email_verifications (
    id                UUID            PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id           UUID            NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token_hash        VARCHAR(128)    NOT NULL UNIQUE,
    expires_at        TIMESTAMPTZ     NOT NULL,
    used_at           TIMESTAMPTZ     NULL,
    created_at        TIMESTAMPTZ     NOT NULL DEFAULT now()
);

-- ─── Password Resets ────────────────────────────────────────────────
CREATE TABLE password_resets (
    id                UUID            PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id           UUID            NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token_hash        VARCHAR(128)    NOT NULL UNIQUE,
    expires_at        TIMESTAMPTZ     NOT NULL,
    used_at           TIMESTAMPTZ     NULL,
    created_at        TIMESTAMPTZ     NOT NULL DEFAULT now()
);

-- ─── Audit Log ──────────────────────────────────────────────────────
CREATE TABLE audit_log (
    id                BIGSERIAL       PRIMARY KEY,
    user_id           UUID            NULL REFERENCES users(id) ON DELETE SET NULL,
    action            VARCHAR(64)     NOT NULL,
    metadata          JSONB           NOT NULL DEFAULT '{}'::jsonb,
    ip                INET            NULL,
    user_agent        TEXT            NULL,
    created_at        TIMESTAMPTZ     NOT NULL DEFAULT now()
);

CREATE INDEX idx_audit_log_user ON audit_log (user_id, created_at DESC);
CREATE INDEX idx_audit_log_action ON audit_log (action, created_at DESC);

-- ─── Trigger pro updated_at ─────────────────────────────────────────
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER users_updated_at
    BEFORE UPDATE ON users
    FOR EACH ROW
    EXECUTE FUNCTION set_updated_at();
