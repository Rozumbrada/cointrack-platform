-- V17.0 — One-time magic tokeny pro deep-link auto-login z mobilní aplikace
-- na web. Příklad: uživatel klikne v mobilu "💎 Upgrade" → backend vystaví
-- magic token → mobil otevře cointrack.cz/auth/magic?t=<UUID>&next=/app/upgrade
-- → web vymění token za plnohodnotný JWT (auth ne­potřeba) a přesměruje.
--
-- Token je single-use, krátkodobý (5 min), a nese reference na userId.

CREATE TABLE magic_tokens (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token_hash  VARCHAR(128) NOT NULL UNIQUE,
    next_path   VARCHAR(256),                 -- kam přesměrovat po exchange
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    expires_at  TIMESTAMPTZ NOT NULL,
    used_at     TIMESTAMPTZ
);

CREATE INDEX idx_magic_tokens_user_id ON magic_tokens(user_id);
