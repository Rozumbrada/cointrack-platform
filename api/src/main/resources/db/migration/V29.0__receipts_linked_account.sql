-- V29: receipts.linked_account_id pro Pohoda XML export.
--
-- Mobil dlouho používá lokální linkedAccountId na Receipt (manuální přiřazení účtu),
-- ale dosud se nesynchronizovalo na backend. Web ho posílal v sync push, ale server
-- ho zahazoval — schema receipts column neměla. Důsledek: Pohoda XML pro CARD účtenky
-- bez linkované transakce nemělo `<bnk:account>` → Pohoda dokument importovala do Pokladny
-- místo Banky.
--
-- Tahle migrace přidá column + index, takže:
--   - PohodaExporter může číst Receipts.linkedAccountId přímo
--   - Web/mobil to syncují obousměrně přes existující sync push/pull
ALTER TABLE receipts ADD COLUMN linked_account_id UUID NULL REFERENCES accounts(id) ON DELETE SET NULL;
CREATE INDEX idx_receipts_linked_account ON receipts(linked_account_id) WHERE deleted_at IS NULL;
