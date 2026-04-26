-- V12.0 Pohoda XML export potřebuje rozdělené číslo účtu + kód banky.
--
-- Doplňujeme:
--   accounts.bank_account_number  (varchar 32) — např. "0000192000145399" nebo "192000-0145399"
--   accounts.bank_code             (varchar 8)  — např. "0100" (KB), "0800" (Česká spořitelna)
--
-- Pole se plní:
--   • ručně uživatelem v editoru účtu (web/mobile),
--   • automaticky při Salt Edge importu z extra.account_number / odvozeno z IBAN,
--   • při Fio sync z FioAccount.accountId / bankId.
--
-- PohodaExporter generuje <typ:accountNo>+<typ:numericCode> pokud jsou pole vyplněná,
-- jinak fallback na parsování IBAN (CZ formát: CZxx BBBB AAAAAAAAAAAAAAAA).

ALTER TABLE accounts ADD COLUMN bank_account_number VARCHAR(32);
ALTER TABLE accounts ADD COLUMN bank_code            VARCHAR(8);
