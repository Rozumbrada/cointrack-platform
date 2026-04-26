-- V11.0 Doplnění merchant identifikace na receipts.
--
-- Mobile model má merchantIco/Dic/Street/City/Zip, ale backend tyto sloupce
-- neuložil — při sync push se ztratily (silently dropped). Přidáváme je teď,
-- aby se data round-trippnula a bylo z čeho generovat Pohoda XML export.
--
-- Invoices už mají supplier_street/city/zip ze sprintu 5b, jen se nikdy
-- nemapovaly v SyncService (oprava v doprovodném kódu).

ALTER TABLE receipts ADD COLUMN merchant_ico    VARCHAR(16);
ALTER TABLE receipts ADD COLUMN merchant_dic    VARCHAR(32);
ALTER TABLE receipts ADD COLUMN merchant_street VARCHAR(256);
ALTER TABLE receipts ADD COLUMN merchant_city   VARCHAR(128);
ALTER TABLE receipts ADD COLUMN merchant_zip    VARCHAR(16);
