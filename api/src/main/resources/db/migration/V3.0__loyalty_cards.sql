-- Sprint 5c.4 — Loyalty cards (věrnostní kartičky)
-- Per-profile entity s volitelnými MinIO storage keys pro front/back photos.

CREATE TABLE loyalty_cards (
    id                UUID            PRIMARY KEY DEFAULT gen_random_uuid(),
    sync_id           UUID            NOT NULL UNIQUE,
    profile_id        UUID            NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,

    store_name        VARCHAR(256)    NOT NULL,
    card_number       VARCHAR(256)    NOT NULL,
    barcode_format    VARCHAR(32)     NOT NULL DEFAULT 'CODE_128',
    color             INTEGER         NULL,
    note              TEXT            NOT NULL DEFAULT '',
    logo_url          TEXT            NULL,

    -- MinIO storage keys pro fotky (front/back)
    front_image_key   TEXT            NULL,
    back_image_key    TEXT            NULL,

    client_version    BIGINT          NOT NULL DEFAULT 1,
    created_at        TIMESTAMPTZ     NOT NULL DEFAULT now(),
    updated_at        TIMESTAMPTZ     NOT NULL DEFAULT now(),
    deleted_at        TIMESTAMPTZ     NULL
);

CREATE INDEX idx_loyalty_cards_profile ON loyalty_cards (profile_id) WHERE deleted_at IS NULL;
CREATE INDEX idx_loyalty_cards_updated ON loyalty_cards (updated_at);
