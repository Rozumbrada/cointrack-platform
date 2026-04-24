-- Sprint 5g.2 — Organization types a currency.
--
-- Organizace dostava sloupec `type` ktery rozlisuje:
--   - 'B2B' (default) = firemní organizace (Sprint 5e)
--   - 'GROUP'         = sdílená skupina pro rozpočet výdajů (Settle Up model)
--
-- Currency je potřeba hlavně pro GROUP typ (skupina má fixní měnu pro výdaje),
-- u B2B orgů se nepoužívá ale nevadí.

ALTER TABLE organizations
    ADD COLUMN type VARCHAR(16) NOT NULL DEFAULT 'B2B';

ALTER TABLE organizations
    ADD COLUMN currency VARCHAR(3) NOT NULL DEFAULT 'CZK';

CREATE INDEX idx_organizations_type ON organizations (type) WHERE deleted_at IS NULL;
