-- V25: normalizace profiles.type na uppercase enum
--
-- Legacy profily (zejména z mobilních verzí před standardizací) mají
-- v DB lowercase hodnoty 'personal', 'business', 'group', 'organization'.
-- Klient (web + mobile) porovnává uppercase, takže string compare selhává:
--   'personal' !== 'PERSONAL' → menu Členové se nezobrazí/zobrazí špatně.
--
-- Standardizujeme na uppercase, konzistentně se Profile.type defaultem
-- a se SubscriptionTier mappingem.

UPDATE profiles SET type = UPPER(type)
WHERE type IS NOT NULL AND type <> UPPER(type);

-- Sjednotit i prázdné na PERSONAL (= server default)
UPDATE profiles SET type = 'PERSONAL'
WHERE type IS NULL OR type = '';
