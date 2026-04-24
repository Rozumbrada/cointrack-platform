-- V10.0 Sprint 8: oddělení bankovních účtů od profilů.
--
-- Změna paradigmu:
--   • bank_accounts_ext  = co Salt Edge zná (existuje na user-level, není svázané s profilem)
--   • bank_account_profile_assignments = explicitní přiřazení uživatelem
--     (uživatel se rozhodne, do jakého profilu chce data Salt Edge účtu importovat)
--
-- Jeden bank_account_ext může být přiřazen k více profilům (např. osobní + firma sdílí účet).
-- Smazání profilu kaskáduje na všechny jeho assignments.

CREATE TABLE bank_account_profile_assignments (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    bank_account_ext_id UUID NOT NULL REFERENCES bank_accounts_ext(id) ON DELETE CASCADE,
    profile_id        UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    auto_import       BOOLEAN NOT NULL DEFAULT FALSE,  -- true = Salt Edge data se sami importují
    created_at        TIMESTAMP NOT NULL DEFAULT NOW(),
    UNIQUE (bank_account_ext_id, profile_id)
);

CREATE INDEX idx_bank_acc_assignments_profile ON bank_account_profile_assignments(profile_id);
CREATE INDEX idx_bank_acc_assignments_account ON bank_account_profile_assignments(bank_account_ext_id);
