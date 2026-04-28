-- V19.0 — GDPR account deletion grace period
--
-- Když user požádá o smazání účtu:
-- - users.deleted_at = now()  → soft delete, sessions zneplatněny
-- - users.delete_requested_at = now()  → marker pro hard-delete worker
-- - users.delete_after_at = now() + 30 days  → kdy se data fyzicky smažou
--
-- 30-denní grace period umožňuje uživateli si to rozmyslet (kontakt podpory).

ALTER TABLE users
    ADD COLUMN delete_requested_at TIMESTAMP NULL,
    ADD COLUMN delete_after_at     TIMESTAMP NULL;

CREATE INDEX idx_users_delete_after ON users(delete_after_at) WHERE delete_after_at IS NOT NULL;
