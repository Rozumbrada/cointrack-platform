-- V20.0 — sledování odeslaných reminderů před expirací předplatného.
--
-- BillingExpiryWorker projíždí denně users a:
--   • Pokud tier_expires_at je za 6-7 dní a tier_reminder_sent_at je null
--     nebo starší než 14 dní → pošle reminder + nastaví tier_reminder_sent_at.
--   • Pokud tier_expires_at < now() a tier != 'FREE' → downgrade na FREE.
--
-- Ochrana proti spamu: reminder se posílá max. 1× per cyklus (období okolo
-- expirace), díky checku posledního zaslání.

ALTER TABLE users
    ADD COLUMN tier_reminder_sent_at TIMESTAMP NULL;

CREATE INDEX idx_users_tier_expires ON users(tier_expires_at)
    WHERE tier_expires_at IS NOT NULL;
