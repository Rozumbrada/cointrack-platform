-- V21.0 — per-account sharing for Organization tier
--
-- Umožňuje sdílet konkrétní bankovní účet s jiným uživatelem (např. účetním).
-- Pozvaný vidí jen sdílený účet + napojené transakce/účtenky/faktury, ne celý
-- profil ani ostatní účty profilu.
--
-- Stav záznamu:
--   user_id = NULL     → pending invite (doručeno emailem, čeká na accept)
--   user_id != NULL    → accepted, sdílení aktivní
--   revoked_at != NULL → odvoláno vlastníkem (data zůstávají, jen ztráta přístupu)
--
-- Role: VIEWER (read-only) | EDITOR (může přidávat/editovat)

CREATE TABLE account_shares (
    id              UUID         NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
    account_id      UUID         NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    user_id         UUID         NULL REFERENCES users(id) ON DELETE CASCADE,
    email           VARCHAR(255) NOT NULL,
    role            VARCHAR(16)  NOT NULL DEFAULT 'VIEWER' CHECK (role IN ('VIEWER', 'EDITOR')),
    invite_token    VARCHAR(128) NULL,
    expires_at      TIMESTAMPTZ  NULL,
    accepted_at     TIMESTAMPTZ  NULL,
    revoked_at      TIMESTAMPTZ  NULL,
    inviter_user_id UUID         NULL REFERENCES users(id) ON DELETE SET NULL,
    created_at      TIMESTAMPTZ  NOT NULL DEFAULT now()
);

-- Jeden email může mít na jednom účtu jen jeden aktivní share.
-- Po revoke je možné pozvat znovu (proto ne UNIQUE bez WHERE).
CREATE UNIQUE INDEX idx_account_shares_email_active
    ON account_shares(account_id, lower(email))
    WHERE revoked_at IS NULL;

CREATE INDEX idx_account_shares_user
    ON account_shares(user_id)
    WHERE user_id IS NOT NULL AND revoked_at IS NULL;

CREATE UNIQUE INDEX idx_account_shares_token
    ON account_shares(invite_token)
    WHERE invite_token IS NOT NULL;
