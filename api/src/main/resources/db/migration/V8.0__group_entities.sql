-- Sprint 5g.2.d — Cloud sync pro skupinove entity (Settle Up model).
--
-- Tyto tabulky jsou zrcadlem toho co Android drzi v Room databazi.
-- Vaze se vzdy na profile_id (profile.type == GROUP).

CREATE TABLE group_members (
    id                UUID            PRIMARY KEY DEFAULT gen_random_uuid(),
    sync_id           UUID            NOT NULL UNIQUE,
    profile_id        UUID            NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    name              VARCHAR(128)    NOT NULL,
    color             INTEGER         NOT NULL DEFAULT -13022129,    -- 0xFF1976D2 signed
    /** Napojeni clena na realny Cointrack ucet (null = guest; Sprint 5g.3). */
    cointrack_user_id UUID            NULL REFERENCES users(id) ON DELETE SET NULL,
    client_version    BIGINT          NOT NULL DEFAULT 1,
    created_at        TIMESTAMPTZ     NOT NULL DEFAULT now(),
    updated_at        TIMESTAMPTZ     NOT NULL DEFAULT now(),
    deleted_at        TIMESTAMPTZ     NULL
);
CREATE INDEX idx_group_members_profile ON group_members (profile_id) WHERE deleted_at IS NULL;
CREATE INDEX idx_group_members_user    ON group_members (cointrack_user_id) WHERE deleted_at IS NULL;

CREATE TABLE group_expenses (
    id                      UUID            PRIMARY KEY DEFAULT gen_random_uuid(),
    sync_id                 UUID            NOT NULL UNIQUE,
    profile_id              UUID            NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    description             VARCHAR(512)    NOT NULL,
    amount                  NUMERIC(18,2)   NOT NULL,
    currency                VARCHAR(3)      NOT NULL DEFAULT 'CZK',
    /** sync_id paying member (ne DB id) — stabilni pres zarizeni. */
    paid_by_member_sync_id  UUID            NOT NULL,
    /** JSON list sync_ids clenu rozdelenych na tento vydaj (allow duplicates = quantity). */
    default_participant_sync_ids TEXT       NOT NULL DEFAULT '[]',
    date                    DATE            NOT NULL,
    note                    TEXT            NULL,
    is_settlement           BOOLEAN         NOT NULL DEFAULT FALSE,
    client_version          BIGINT          NOT NULL DEFAULT 1,
    created_at              TIMESTAMPTZ     NOT NULL DEFAULT now(),
    updated_at              TIMESTAMPTZ     NOT NULL DEFAULT now(),
    deleted_at              TIMESTAMPTZ     NULL
);
CREATE INDEX idx_group_expenses_profile ON group_expenses (profile_id) WHERE deleted_at IS NULL;

CREATE TABLE group_expense_items (
    id                     UUID            PRIMARY KEY DEFAULT gen_random_uuid(),
    sync_id                UUID            NOT NULL UNIQUE,
    expense_id             UUID            NOT NULL REFERENCES group_expenses(id) ON DELETE CASCADE,
    name                   VARCHAR(256)    NOT NULL,
    amount                 NUMERIC(18,2)   NOT NULL,
    /** JSON list member sync_ids (s duplikaty = quantity). */
    participant_sync_ids   TEXT            NOT NULL DEFAULT '[]',
    position               INTEGER         NOT NULL DEFAULT 0,
    client_version         BIGINT          NOT NULL DEFAULT 1,
    created_at             TIMESTAMPTZ     NOT NULL DEFAULT now(),
    updated_at             TIMESTAMPTZ     NOT NULL DEFAULT now(),
    deleted_at             TIMESTAMPTZ     NULL
);
CREATE INDEX idx_group_expense_items_expense ON group_expense_items (expense_id) WHERE deleted_at IS NULL;
