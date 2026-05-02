-- V31: Index na invoices(profile_id, idoklad_id) — bez něj iDoklad sync
-- dělal full-table scan na každou jednu fakturu (O(n²)), což web zasekávalo
-- s rostoucím počtem faktur. Příznak v UI: po kliknutí na profile change
-- byl web pomalý / zaseklý dokud server iDoklad sync nedoběhl.
--
-- Index je partial — jen řádky s vyplněným idoklad_id (= jen iDoklad faktury).
-- Šetří místo + zrychluje typický lookup `WHERE profile_id = ? AND idoklad_id = ?`.

CREATE INDEX IF NOT EXISTS idx_invoices_profile_idoklad
  ON invoices (profile_id, idoklad_id)
  WHERE idoklad_id IS NOT NULL;
