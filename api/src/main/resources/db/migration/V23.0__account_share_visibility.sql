-- V23: per-share visibility filters
--
-- Při sdílení účtu může vlastník zúžit, jaké transakce sdílený uživatel uvidí:
--   - visibility_income / visibility_expenses (true = uvidí, false = skryje)
--   - visibility_categories: JSON-encoded array UUID kategorií (nullable; null = bez omezení)
--
-- Filtry se aplikují JEN pro role VIEWER a EDITOR. ACCOUNTANT vidí celý profil
-- bez omezení (viz syncservice).

ALTER TABLE account_shares
    ADD COLUMN visibility_income      BOOLEAN NOT NULL DEFAULT TRUE,
    ADD COLUMN visibility_expenses    BOOLEAN NOT NULL DEFAULT TRUE,
    ADD COLUMN visibility_categories  TEXT    NULL;
