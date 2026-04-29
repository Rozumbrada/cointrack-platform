-- V24: rename tier ORGANIZATION → BUSINESS_PRO
--
-- User feedback: 'Organization' (ze Cointrack `Organization` multi-user
-- struktury) bylo matoucí jako tier name. Přejmenováváme na 'Business Pro'
-- napříč backendem, mobilem a webem.
--
-- Důsledky:
--   - users.tier dostává novou hodnotu 'BUSINESS_PRO'
--   - payments.tier (historické záznamy) zachováme jak je — invoices/SPAYD
--     z dřívějška měly tier='ORGANIZATION', pro audit důvody nepřepisujeme.
--     Pricing tabulka (Kotlin Map) bude mít obě klíče pro zpětnou kompat.
--
-- Profile.type 'ORGANIZATION' (legacy typ profilu, oddělený od tier) zůstává.

-- 1) users.tier
UPDATE users SET tier = 'BUSINESS_PRO', updated_at = now()
WHERE tier = 'ORGANIZATION';

-- 2) payments.tier — historické záznamy nepřepisujeme (faktura 2024 nemůže
--    být přejmenovaná). Nové platby budou mít 'BUSINESS_PRO' z aplikace.
