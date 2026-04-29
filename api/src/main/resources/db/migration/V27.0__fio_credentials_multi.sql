-- V27: multi-credential Fio Bank — jeden profil může mít víc Fio API tokenů
--
-- V26 zavedla 1 token per profil (sloupce na `profiles`). Reálný use-case
-- ale vyžaduje víc — uživatel má víc Fio účtů (osobní + business + spoření)
-- a každý chce synchronizovat samostatně. Mobile už dlouho má entitu
-- `fio_accounts` (per-profile, multi), tato migrace dorovnává backend.
--
-- Nová tabulka `fio_credentials` má 1:1 mapping s mobilní `fio_accounts`
-- entitou přes UUID id (= syncId). Mobile po uložení FioAccount push-uje
-- token na backend pod stejným ID; backend vrací status seznamu (bez tokenu).
--
-- Token je AES-GCM šifrovaný stejnou klíčem jako idoklad (env IDOKLAD_ENC_KEY).

CREATE TABLE fio_credentials (
    id                  UUID         PRIMARY KEY,
    profile_id          UUID         NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    name                TEXT         NOT NULL,
    token_enc           TEXT         NOT NULL,
    account_iban        TEXT         NULL,            -- auto-discovered při prvním syncu
    last_sync_at        TIMESTAMPTZ  NULL,
    last_movement_id    BIGINT       NULL,            -- Fio set-last-id cursor
    created_at          TIMESTAMPTZ  NOT NULL DEFAULT now(),
    updated_at          TIMESTAMPTZ  NOT NULL DEFAULT now(),
    deleted_at          TIMESTAMPTZ  NULL
);

CREATE INDEX idx_fio_credentials_profile_id ON fio_credentials(profile_id) WHERE deleted_at IS NULL;

-- Migrate existing tokens z profiles.fio_token_enc do fio_credentials
INSERT INTO fio_credentials (id, profile_id, name, token_enc, account_iban, last_sync_at, last_movement_id, created_at, updated_at)
SELECT
    gen_random_uuid(),
    id,
    'Fio účet',                     -- default jméno (uživatel může přejmenovat)
    fio_token_enc,
    (SELECT bank_iban FROM accounts a WHERE a.profile_id = profiles.id AND a.bank_provider = 'fio' AND a.deleted_at IS NULL LIMIT 1),
    fio_last_sync_at,
    fio_last_movement_id,
    now(),
    now()
FROM profiles
WHERE fio_token_enc IS NOT NULL AND deleted_at IS NULL;

-- Staré sloupce v `profiles` ponecháme jako deprecated (read-only z app pohledu)
-- pro jistotu — pokud by deploy backendu nestihl restart a starý kód by si je
-- chtěl číst, padlo by to. V8 migrace je odstraní později.
COMMENT ON COLUMN profiles.fio_token_enc IS 'DEPRECATED V27 — použij fio_credentials.token_enc';
COMMENT ON COLUMN profiles.fio_last_sync_at IS 'DEPRECATED V27 — použij fio_credentials.last_sync_at';
COMMENT ON COLUMN profiles.fio_last_movement_id IS 'DEPRECATED V27 — použij fio_credentials.last_movement_id';
