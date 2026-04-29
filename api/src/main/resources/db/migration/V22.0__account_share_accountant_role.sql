-- V22.0 — rozšíření CHECK constraint na role ACCOUNTANT
--
-- ACCOUNTANT = read-only přístup k účtu (jako VIEWER)
--              + možnost exportu (Pohoda XML, ZIP pro daňové přiznání)
-- Existující záznamy s VIEWER nebo EDITOR zůstávají platné.

ALTER TABLE account_shares
    DROP CONSTRAINT IF EXISTS account_shares_role_check;

ALTER TABLE account_shares
    ADD CONSTRAINT account_shares_role_check
    CHECK (role IN ('VIEWER', 'EDITOR', 'ACCOUNTANT'));
