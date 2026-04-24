-- Sprint 5c.5 — zbývající entity (budgets, planned_payments, debts, goals,
-- warranties, shopping_lists, shopping_items, merchant_rules,
-- investment_positions, fio_accounts).

CREATE TABLE budgets (
    id                UUID            PRIMARY KEY DEFAULT gen_random_uuid(),
    sync_id           UUID            NOT NULL UNIQUE,
    profile_id        UUID            NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    category_id       UUID            NULL REFERENCES categories(id) ON DELETE CASCADE,
    name              VARCHAR(256)    NOT NULL,
    "limit"           NUMERIC(18,2)   NOT NULL,
    period            VARCHAR(16)     NOT NULL DEFAULT 'MONTHLY',
    currency          VARCHAR(3)      NOT NULL DEFAULT 'CZK',
    client_version    BIGINT          NOT NULL DEFAULT 1,
    created_at        TIMESTAMPTZ     NOT NULL DEFAULT now(),
    updated_at        TIMESTAMPTZ     NOT NULL DEFAULT now(),
    deleted_at        TIMESTAMPTZ     NULL
);
CREATE INDEX idx_budgets_profile ON budgets (profile_id) WHERE deleted_at IS NULL;

CREATE TABLE planned_payments (
    id                UUID            PRIMARY KEY DEFAULT gen_random_uuid(),
    sync_id           UUID            NOT NULL UNIQUE,
    profile_id        UUID            NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    account_id        UUID            NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    category_id       UUID            NULL REFERENCES categories(id) ON DELETE SET NULL,
    name              VARCHAR(256)    NOT NULL,
    amount            NUMERIC(18,2)   NOT NULL,
    currency          VARCHAR(3)      NOT NULL DEFAULT 'CZK',
    type              VARCHAR(16)     NOT NULL DEFAULT 'EXPENSE',
    period            VARCHAR(16)     NOT NULL DEFAULT 'MONTHLY',
    next_date         DATE            NOT NULL,
    note              TEXT            NOT NULL DEFAULT '',
    is_active         BOOLEAN         NOT NULL DEFAULT true,
    client_version    BIGINT          NOT NULL DEFAULT 1,
    created_at        TIMESTAMPTZ     NOT NULL DEFAULT now(),
    updated_at        TIMESTAMPTZ     NOT NULL DEFAULT now(),
    deleted_at        TIMESTAMPTZ     NULL
);
CREATE INDEX idx_planned_payments_profile ON planned_payments (profile_id) WHERE deleted_at IS NULL;

CREATE TABLE debts (
    id                UUID            PRIMARY KEY DEFAULT gen_random_uuid(),
    sync_id           UUID            NOT NULL UNIQUE,
    profile_id        UUID            NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    person_name       VARCHAR(256)    NOT NULL,
    amount            NUMERIC(18,2)   NOT NULL,
    currency          VARCHAR(3)      NOT NULL DEFAULT 'CZK',
    type              VARCHAR(16)     NOT NULL DEFAULT 'BORROWED',
    description       TEXT            NOT NULL DEFAULT '',
    due_date          DATE            NULL,
    is_paid           BOOLEAN         NOT NULL DEFAULT false,
    created_date      DATE            NOT NULL,
    client_version    BIGINT          NOT NULL DEFAULT 1,
    created_at        TIMESTAMPTZ     NOT NULL DEFAULT now(),
    updated_at        TIMESTAMPTZ     NOT NULL DEFAULT now(),
    deleted_at        TIMESTAMPTZ     NULL
);
CREATE INDEX idx_debts_profile ON debts (profile_id) WHERE deleted_at IS NULL;

CREATE TABLE goals (
    id                UUID            PRIMARY KEY DEFAULT gen_random_uuid(),
    sync_id           UUID            NOT NULL UNIQUE,
    profile_id        UUID            NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    name              VARCHAR(256)    NOT NULL,
    target_amount     NUMERIC(18,2)   NOT NULL,
    current_amount    NUMERIC(18,2)   NOT NULL DEFAULT 0,
    currency          VARCHAR(3)      NOT NULL DEFAULT 'CZK',
    color             INTEGER         NULL,
    deadline          DATE            NULL,
    note              TEXT            NOT NULL DEFAULT '',
    client_version    BIGINT          NOT NULL DEFAULT 1,
    created_at        TIMESTAMPTZ     NOT NULL DEFAULT now(),
    updated_at        TIMESTAMPTZ     NOT NULL DEFAULT now(),
    deleted_at        TIMESTAMPTZ     NULL
);
CREATE INDEX idx_goals_profile ON goals (profile_id) WHERE deleted_at IS NULL;

CREATE TABLE warranties (
    id                  UUID            PRIMARY KEY DEFAULT gen_random_uuid(),
    sync_id             UUID            NOT NULL UNIQUE,
    profile_id          UUID            NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    product_name        VARCHAR(256)    NOT NULL,
    shop                VARCHAR(256)    NOT NULL DEFAULT '',
    purchase_date       DATE            NOT NULL,
    warranty_years      INTEGER         NOT NULL DEFAULT 2,
    price               NUMERIC(18,2)   NULL,
    currency            VARCHAR(3)      NOT NULL DEFAULT 'CZK',
    note                TEXT            NOT NULL DEFAULT '',
    receipt_image_key   TEXT            NULL,
    client_version      BIGINT          NOT NULL DEFAULT 1,
    created_at          TIMESTAMPTZ     NOT NULL DEFAULT now(),
    updated_at          TIMESTAMPTZ     NOT NULL DEFAULT now(),
    deleted_at          TIMESTAMPTZ     NULL
);
CREATE INDEX idx_warranties_profile ON warranties (profile_id) WHERE deleted_at IS NULL;

CREATE TABLE shopping_lists (
    id                UUID            PRIMARY KEY DEFAULT gen_random_uuid(),
    sync_id           UUID            NOT NULL UNIQUE,
    profile_id        UUID            NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    name              VARCHAR(256)    NOT NULL,
    color             INTEGER         NOT NULL DEFAULT 0,
    client_version    BIGINT          NOT NULL DEFAULT 1,
    created_at        TIMESTAMPTZ     NOT NULL DEFAULT now(),
    updated_at        TIMESTAMPTZ     NOT NULL DEFAULT now(),
    deleted_at        TIMESTAMPTZ     NULL
);
CREATE INDEX idx_shopping_lists_profile ON shopping_lists (profile_id) WHERE deleted_at IS NULL;

CREATE TABLE shopping_items (
    id                UUID            PRIMARY KEY DEFAULT gen_random_uuid(),
    sync_id           UUID            NOT NULL UNIQUE,
    list_id           UUID            NOT NULL REFERENCES shopping_lists(id) ON DELETE CASCADE,
    name              VARCHAR(256)    NOT NULL,
    quantity          VARCHAR(32)     NOT NULL DEFAULT '1',
    price             NUMERIC(18,2)   NULL,
    is_checked        BOOLEAN         NOT NULL DEFAULT false,
    client_version    BIGINT          NOT NULL DEFAULT 1,
    created_at        TIMESTAMPTZ     NOT NULL DEFAULT now(),
    updated_at        TIMESTAMPTZ     NOT NULL DEFAULT now(),
    deleted_at        TIMESTAMPTZ     NULL
);
CREATE INDEX idx_shopping_items_list ON shopping_items (list_id) WHERE deleted_at IS NULL;

CREATE TABLE merchant_rules (
    id                UUID            PRIMARY KEY DEFAULT gen_random_uuid(),
    sync_id           UUID            NOT NULL UNIQUE,
    profile_id        UUID            NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    category_id       UUID            NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
    keyword           VARCHAR(256)    NOT NULL,
    created_at_str    TEXT            NOT NULL DEFAULT '',
    client_version    BIGINT          NOT NULL DEFAULT 1,
    created_at        TIMESTAMPTZ     NOT NULL DEFAULT now(),
    updated_at        TIMESTAMPTZ     NOT NULL DEFAULT now(),
    deleted_at        TIMESTAMPTZ     NULL
);
CREATE INDEX idx_merchant_rules_profile ON merchant_rules (profile_id) WHERE deleted_at IS NULL;

CREATE TABLE investment_positions (
    id                         UUID            PRIMARY KEY DEFAULT gen_random_uuid(),
    sync_id                    UUID            NOT NULL UNIQUE,
    profile_id                 UUID            NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    account_id                 UUID            NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    symbol                     VARCHAR(32)     NOT NULL,
    name                       VARCHAR(256)    NOT NULL,
    quantity                   NUMERIC(18,6)   NOT NULL,
    buy_price                  NUMERIC(18,4)   NOT NULL,
    buy_currency               VARCHAR(8)      NOT NULL,
    buy_date                   VARCHAR(16)     NOT NULL,
    platform                   VARCHAR(64)     NOT NULL,
    is_open                    BOOLEAN         NOT NULL DEFAULT true,
    sell_price                 NUMERIC(18,4)   NULL,
    sell_date                  VARCHAR(16)     NULL,
    yahoo_symbol               VARCHAR(32)     NULL,
    notes                      TEXT            NULL,
    client_version             BIGINT          NOT NULL DEFAULT 1,
    created_at                 TIMESTAMPTZ     NOT NULL DEFAULT now(),
    updated_at                 TIMESTAMPTZ     NOT NULL DEFAULT now(),
    deleted_at                 TIMESTAMPTZ     NULL
);
CREATE INDEX idx_investment_positions_profile ON investment_positions (profile_id) WHERE deleted_at IS NULL;

CREATE TABLE fio_accounts (
    id                   UUID            PRIMARY KEY DEFAULT gen_random_uuid(),
    sync_id              UUID            NOT NULL UNIQUE,
    profile_id           UUID            NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    name                 VARCHAR(256)    NOT NULL,
    linked_account_id    UUID            NULL REFERENCES accounts(id) ON DELETE SET NULL,
    last_sync            TEXT            NULL,
    is_enabled           BOOLEAN         NOT NULL DEFAULT true,
    -- POZOR: token NE-synced (security credential, zůstává v klientu)
    client_version       BIGINT          NOT NULL DEFAULT 1,
    created_at           TIMESTAMPTZ     NOT NULL DEFAULT now(),
    updated_at           TIMESTAMPTZ     NOT NULL DEFAULT now(),
    deleted_at           TIMESTAMPTZ     NULL
);
CREATE INDEX idx_fio_accounts_profile ON fio_accounts (profile_id) WHERE deleted_at IS NULL;
