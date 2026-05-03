-- V32: Provozovna na účtence
--
-- Provozovna = konkrétní pobočka obchodu, jak je uvedená na účtence
-- (např. "Albert Jihlava — Náměstí Svobody"). Drží se POUZE na serveru,
-- mobilní Room DB sloupec nemá, Pohoda XML export ji neexportuje.
ALTER TABLE receipts
ADD COLUMN provozovna VARCHAR(256);
