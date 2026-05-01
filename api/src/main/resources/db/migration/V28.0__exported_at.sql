-- V28: track exportedAt na účtenkách a fakturách
--
-- Po úspěšném Pohoda XML exportu označíme dotčené entity timestampem,
-- aby UI dokázalo zobrazit "exportováno" badge a uživatel se vyhnul
-- duplicitním importům do Pohody.

ALTER TABLE receipts ADD COLUMN exported_at TIMESTAMPTZ NULL;
ALTER TABLE invoices ADD COLUMN exported_at TIMESTAMPTZ NULL;

-- Indexy pro rychlé filtrování "neexportované":
CREATE INDEX idx_receipts_exported_at ON receipts(profile_id, exported_at) WHERE deleted_at IS NULL;
CREATE INDEX idx_invoices_exported_at ON invoices(profile_id, exported_at) WHERE deleted_at IS NULL;
