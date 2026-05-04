-- V33: Doplnění bankovních polí transakce — bankovní kód protiúčtu + BIC.
--
-- Před fixem mobile sync mapper neuložil tyto fioci sloupce 3 (kódBanky)
-- a 26 (BIC) na server. Po sync round-tripu (= web modifikuje tx, mobil
-- pull-ne) se hodnoty ztratily z mobilního Room DB. Detail transakce
-- pak ukázal "občas chybí KS/SS/protiúčet" inkonzistentně.
--
-- bankCs (KS) a bankSs (SS) sloupce už existovaly (V19), ale sync mapper
-- je nepoužíval — opravujeme v aplikační vrstvě bez DB změny.
ALTER TABLE transactions
ADD COLUMN bank_counterparty_code VARCHAR(16);

ALTER TABLE transactions
ADD COLUMN bank_bic VARCHAR(16);
