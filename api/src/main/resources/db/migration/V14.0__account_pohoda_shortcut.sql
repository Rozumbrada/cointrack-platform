-- V14.0 — Pohoda "Zkratka" na účtu (typ:ids pro Pohoda XML import).
--
-- Pohoda bank.xsd vyžaduje pro <bnk:account> typ:refType, který přijímá pouze
-- <typ:ids> (nikoli accountNo+numericCode/bankCode). Uživatel zadá v Cointracku
-- shodnou Zkratku jako má v Pohoda → Banky → Zkratka, např. "FIO".

ALTER TABLE accounts ADD COLUMN pohoda_shortcut VARCHAR(19);
