-- V9.1 Banking — převod JSONB sloupců na TEXT.
--
-- Exposed ORM posílá hodnoty jako VARCHAR, což Postgres u JSONB sloupců odmítá.
-- Raw payload/extra jsou jen audit/debug data — strukturované dotazy nad nimi
-- nepotřebujeme, takže TEXT postačuje a ušetří nám custom Exposed binding.
--
-- USING .::TEXT je no-op cast (JSONB → TEXT vrátí kanonický JSON string).

ALTER TABLE bank_webhook_events    ALTER COLUMN payload TYPE TEXT USING payload::TEXT;
ALTER TABLE bank_accounts_ext      ALTER COLUMN raw     TYPE TEXT USING raw::TEXT;
ALTER TABLE bank_transactions_ext  ALTER COLUMN extra   TYPE TEXT USING extra::TEXT;
ALTER TABLE bank_transactions_ext  ALTER COLUMN raw     TYPE TEXT USING raw::TEXT;
