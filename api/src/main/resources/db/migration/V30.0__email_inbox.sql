-- V30: Email inbox pro automatické přijímání faktur.
--
-- Uživatel propojí IMAP mailbox → server periodicky stahuje nové emaily,
-- vytahuje přílohy (PDF/JPG/PNG) + tělo emailu, prožene přes Gemini OCR
-- a vytvoří faktury s `source='email'`. Pokud najde matching bank tx,
-- nastaví `linkedTransactionId + paid=true`. Jinak nepřiřazené, paid=false
-- (uživatel pak v UI klikne "Zaplatit" → výběr účtu → vznikne tx).

CREATE TABLE email_accounts (
    id                          UUID PRIMARY KEY,
    sync_id                     UUID NOT NULL UNIQUE,
    profile_id                  UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,

    provider                    VARCHAR(16) NOT NULL DEFAULT 'IMAP',  -- IMAP, GMAIL_OAUTH (later)
    display_label               VARCHAR(128),

    -- IMAP credentials (heslo AES-256-GCM šifrované, base64)
    imap_host                   VARCHAR(128),
    imap_port                   INTEGER DEFAULT 993,
    imap_username               VARCHAR(255),
    imap_password_enc           TEXT,
    imap_ssl                    BOOLEAN NOT NULL DEFAULT TRUE,

    -- OAuth tokens (placeholder pro Phase 3 — Gmail/Outlook)
    oauth_refresh_token_enc     TEXT,

    -- Filter rules
    folder                      VARCHAR(64) NOT NULL DEFAULT 'INBOX',
    sender_whitelist            TEXT,                  -- CSV emails (volitelný)
    subject_filter              VARCHAR(255),          -- regex (volitelný)

    -- State tracking
    last_synced_at              TIMESTAMPTZ,
    last_synced_uid             VARCHAR(64),           -- IMAP UID watermark
    last_sync_error             TEXT,                  -- poslední chyba (pro UI)
    sync_interval_hours         INTEGER NOT NULL DEFAULT 6,

    enabled                     BOOLEAN NOT NULL DEFAULT TRUE,

    client_version              BIGINT NOT NULL DEFAULT 1,
    created_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    deleted_at                  TIMESTAMPTZ NULL
);

CREATE INDEX idx_email_accounts_profile ON email_accounts(profile_id) WHERE deleted_at IS NULL;
CREATE INDEX idx_email_accounts_enabled ON email_accounts(enabled, last_synced_at) WHERE deleted_at IS NULL AND enabled = TRUE;

-- Rozšíření invoices o origin tracking
ALTER TABLE invoices ADD COLUMN source VARCHAR(16);                                     -- 'manual' | 'scan' | 'idoklad' | 'email'
ALTER TABLE invoices ADD COLUMN email_account_id UUID NULL REFERENCES email_accounts(id) ON DELETE SET NULL;
ALTER TABLE invoices ADD COLUMN email_subject VARCHAR(512);
ALTER TABLE invoices ADD COLUMN email_sender VARCHAR(255);
ALTER TABLE invoices ADD COLUMN email_message_id VARCHAR(255);                          -- pro dedup proti opakovanému stažení
ALTER TABLE invoices ADD COLUMN email_received_at TIMESTAMPTZ;

-- Dedup index — stejný IMAP message-id v tom samém profilu = nestahuj znovu
CREATE UNIQUE INDEX idx_invoices_email_msgid_dedup ON invoices(profile_id, email_message_id)
    WHERE email_message_id IS NOT NULL AND deleted_at IS NULL;
