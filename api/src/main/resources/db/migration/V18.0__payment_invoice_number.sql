-- V18.0 — invoice_number na payments + sekvence pro generování čísel faktur.
--
-- Formát čísla: <YYYY><000001> — rok + 6místné pořadí v rámci roku.
-- Pro start používáme jeden globální counter (jednodušší než per-year reset).

ALTER TABLE payments ADD COLUMN invoice_number VARCHAR(32);
CREATE INDEX idx_payments_invoice_number ON payments(invoice_number);

-- Sekvence pro generování invoice numbers
CREATE SEQUENCE IF NOT EXISTS payment_invoice_seq START 1;
