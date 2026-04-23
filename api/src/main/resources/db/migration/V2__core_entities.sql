-- Cointrack core entities: profiles, accounts, categories, transactions,
-- receipts + items, invoices + items.
--
-- Všechny entity sdílí sync pattern: sync_id (stabilní UUID napříč zařízeními),
-- updated_at, deleted_at (soft delete), client_version (optimistic locking).

-- ─── Profiles ──────────────────────────────────────────────────────
CREATE TABLE profiles (
    id                UUID            PRIMARY KEY DEFAULT gen_random_uuid(),
    sync_id           UUID            NOT NULL UNIQUE,
    owner_user_id     UUID            NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name              VARCHAR(128)    NOT NULL,
    type              VARCHAR(16)     NOT NULL,    -- 'personal' | 'business'
    color             INTEGER         NULL,        -- ARGB int
    business_focus    VARCHAR(32)     NULL,        -- HEALTHCARE | IT_TECH | ...

    -- Firemní údaje (nullable, použité jen pro business)
    ico               VARCHAR(16)     NULL,
    dic               VARCHAR(32)     NULL,
    company_name      VARCHAR(256)    NULL,
    street            VARCHAR(256)    NULL,
    zip               VARCHAR(16)     NULL,
    city              VARCHAR(128)    NULL,
    phone             VARCHAR(64)     NULL,
    email             VARCHAR(255)    NULL,

    client_version    BIGINT          NOT NULL DEFAULT 1,
    created_at        TIMESTAMPTZ     NOT NULL DEFAULT now(),
    updated_at        TIMESTAMPTZ     NOT NULL DEFAULT now(),
    deleted_at        TIMESTAMPTZ     NULL
);
CREATE INDEX idx_profiles_owner ON profiles (owner_user_id) WHERE deleted_at IS NULL;
CREATE INDEX idx_profiles_updated ON profiles (owner_user_id, updated_at);

-- ─── Accounts ──────────────────────────────────────────────────────
CREATE TABLE accounts (
    id                UUID            PRIMARY KEY DEFAULT gen_random_uuid(),
    sync_id           UUID            NOT NULL UNIQUE,
    profile_id        UUID            NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,

    name              VARCHAR(128)    NOT NULL,
    type              VARCHAR(32)     NOT NULL,    -- 'cash' | 'checking' | 'savings' | ...
    currency          VARCHAR(3)      NOT NULL DEFAULT 'CZK',
    initial_balance   NUMERIC(18,2)   NOT NULL DEFAULT 0,
    color             INTEGER         NULL,
    icon              VARCHAR(64)     NULL,
    excluded_from_total BOOLEAN       NOT NULL DEFAULT false,

    -- Napojení na banku (Fio, PSD2)
    bank_provider     VARCHAR(32)     NULL,        -- 'fio' | 'gocardless' | 'enablebanking'
    bank_external_id  VARCHAR(128)    NULL,
    bank_iban         VARCHAR(64)     NULL,

    client_version    BIGINT          NOT NULL DEFAULT 1,
    created_at        TIMESTAMPTZ     NOT NULL DEFAULT now(),
    updated_at        TIMESTAMPTZ     NOT NULL DEFAULT now(),
    deleted_at        TIMESTAMPTZ     NULL
);
CREATE INDEX idx_accounts_profile ON accounts (profile_id) WHERE deleted_at IS NULL;
CREATE INDEX idx_accounts_updated ON accounts (profile_id, updated_at);

-- ─── Categories ────────────────────────────────────────────────────
CREATE TABLE categories (
    id                UUID            PRIMARY KEY DEFAULT gen_random_uuid(),
    sync_id           UUID            NOT NULL UNIQUE,
    profile_id        UUID            NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,

    name              VARCHAR(128)    NOT NULL,
    name_en           VARCHAR(128)    NULL,        -- Anglický překlad (volitelný)
    type              VARCHAR(16)     NOT NULL,    -- 'expense' | 'income'
    color             INTEGER         NULL,
    icon              VARCHAR(64)     NULL,
    position          INTEGER         NOT NULL DEFAULT 0,

    client_version    BIGINT          NOT NULL DEFAULT 1,
    created_at        TIMESTAMPTZ     NOT NULL DEFAULT now(),
    updated_at        TIMESTAMPTZ     NOT NULL DEFAULT now(),
    deleted_at        TIMESTAMPTZ     NULL
);
CREATE INDEX idx_categories_profile ON categories (profile_id) WHERE deleted_at IS NULL;
CREATE INDEX idx_categories_updated ON categories (profile_id, updated_at);

-- ─── Transactions ──────────────────────────────────────────────────
CREATE TABLE transactions (
    id                UUID            PRIMARY KEY DEFAULT gen_random_uuid(),
    sync_id           UUID            NOT NULL UNIQUE,
    profile_id        UUID            NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    account_id        UUID            NULL REFERENCES accounts(id) ON DELETE SET NULL,
    category_id       UUID            NULL REFERENCES categories(id) ON DELETE SET NULL,

    amount            NUMERIC(18,2)   NOT NULL,    -- záporné = výdaj, kladné = příjem
    currency          VARCHAR(3)      NOT NULL DEFAULT 'CZK',
    description       TEXT            NULL,
    merchant          VARCHAR(256)    NULL,
    date              DATE            NOT NULL,

    -- Bankovní metadata (pro import z Fio / PSD2)
    bank_tx_id        VARCHAR(128)    NULL,        -- stabilní ID z banky, pro deduplication
    bank_vs           VARCHAR(32)     NULL,        -- variabilní symbol
    bank_cs           VARCHAR(32)     NULL,        -- konstantní symbol
    bank_ss           VARCHAR(32)     NULL,        -- specifický symbol
    bank_counterparty VARCHAR(128)    NULL,        -- protistrana (IBAN / č. účtu)
    bank_counterparty_name VARCHAR(256) NULL,

    is_transfer       BOOLEAN         NOT NULL DEFAULT false,
    transfer_pair_id  UUID            NULL,        -- druhá strana transferu

    client_version    BIGINT          NOT NULL DEFAULT 1,
    created_at        TIMESTAMPTZ     NOT NULL DEFAULT now(),
    updated_at        TIMESTAMPTZ     NOT NULL DEFAULT now(),
    deleted_at        TIMESTAMPTZ     NULL
);
CREATE INDEX idx_transactions_profile_date ON transactions (profile_id, date DESC) WHERE deleted_at IS NULL;
CREATE INDEX idx_transactions_account ON transactions (account_id) WHERE deleted_at IS NULL;
CREATE INDEX idx_transactions_category ON transactions (category_id) WHERE deleted_at IS NULL;
CREATE INDEX idx_transactions_updated ON transactions (profile_id, updated_at);
CREATE INDEX idx_transactions_bank_tx ON transactions (account_id, bank_tx_id) WHERE bank_tx_id IS NOT NULL;

-- ─── Receipts ──────────────────────────────────────────────────────
CREATE TABLE receipts (
    id                UUID            PRIMARY KEY DEFAULT gen_random_uuid(),
    sync_id           UUID            NOT NULL UNIQUE,
    profile_id        UUID            NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    category_id       UUID            NULL REFERENCES categories(id) ON DELETE SET NULL,
    transaction_id    UUID            NULL REFERENCES transactions(id) ON DELETE SET NULL,

    merchant_name     VARCHAR(256)    NULL,
    date              DATE            NOT NULL,
    time              VARCHAR(8)      NULL,        -- HH:MM
    total_with_vat    NUMERIC(18,2)   NOT NULL DEFAULT 0,
    total_without_vat NUMERIC(18,2)   NULL,
    currency          VARCHAR(3)      NOT NULL DEFAULT 'CZK',
    payment_method    VARCHAR(16)     NULL,        -- 'cash' | 'card' | 'unknown'
    note              TEXT            NULL,

    -- Photo keys (S3 object keys), array of strings jako JSONB
    photo_keys        JSONB           NOT NULL DEFAULT '[]'::jsonb,

    client_version    BIGINT          NOT NULL DEFAULT 1,
    created_at        TIMESTAMPTZ     NOT NULL DEFAULT now(),
    updated_at        TIMESTAMPTZ     NOT NULL DEFAULT now(),
    deleted_at        TIMESTAMPTZ     NULL
);
CREATE INDEX idx_receipts_profile_date ON receipts (profile_id, date DESC) WHERE deleted_at IS NULL;
CREATE INDEX idx_receipts_updated ON receipts (profile_id, updated_at);

CREATE TABLE receipt_items (
    id                UUID            PRIMARY KEY DEFAULT gen_random_uuid(),
    sync_id           UUID            NOT NULL UNIQUE,
    receipt_id        UUID            NOT NULL REFERENCES receipts(id) ON DELETE CASCADE,

    name              VARCHAR(256)    NOT NULL,
    quantity          NUMERIC(10,3)   NOT NULL DEFAULT 1,
    unit_price        NUMERIC(18,2)   NULL,
    total_price       NUMERIC(18,2)   NOT NULL,
    vat_rate          NUMERIC(5,2)    NULL,        -- 21.00, 15.00, 12.00, 10.00, 0.00
    position          INTEGER         NOT NULL DEFAULT 0,

    client_version    BIGINT          NOT NULL DEFAULT 1,
    created_at        TIMESTAMPTZ     NOT NULL DEFAULT now(),
    updated_at        TIMESTAMPTZ     NOT NULL DEFAULT now(),
    deleted_at        TIMESTAMPTZ     NULL
);
CREATE INDEX idx_receipt_items_receipt ON receipt_items (receipt_id) WHERE deleted_at IS NULL;

-- ─── Invoices ──────────────────────────────────────────────────────
CREATE TABLE invoices (
    id                UUID            PRIMARY KEY DEFAULT gen_random_uuid(),
    sync_id           UUID            NOT NULL UNIQUE,
    profile_id        UUID            NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    category_id       UUID            NULL REFERENCES categories(id) ON DELETE SET NULL,
    linked_account_id UUID            NULL REFERENCES accounts(id) ON DELETE SET NULL,
    linked_transaction_id UUID        NULL REFERENCES transactions(id) ON DELETE SET NULL,

    invoice_number    VARCHAR(64)     NULL,
    is_expense        BOOLEAN         NOT NULL,    -- true = přijatá, false = vydaná
    issue_date        DATE            NULL,
    due_date          DATE            NULL,

    total_with_vat    NUMERIC(18,2)   NOT NULL DEFAULT 0,
    total_without_vat NUMERIC(18,2)   NULL,
    currency          VARCHAR(3)      NOT NULL DEFAULT 'CZK',

    -- Placení
    payment_method    VARCHAR(16)     NULL,        -- 'bank_transfer' | 'card' | 'cash'
    variable_symbol   VARCHAR(32)     NULL,
    bank_account      VARCHAR(64)     NULL,
    paid              BOOLEAN         NOT NULL DEFAULT false,

    -- Supplier (dodavatel)
    supplier_name     VARCHAR(256)    NULL,
    supplier_ico      VARCHAR(16)     NULL,
    supplier_dic      VARCHAR(32)     NULL,
    supplier_street   VARCHAR(256)    NULL,
    supplier_city     VARCHAR(128)    NULL,
    supplier_zip      VARCHAR(16)     NULL,

    -- Customer (odběratel)
    customer_name     VARCHAR(256)    NULL,

    note              TEXT            NULL,

    -- File keys (S3 object keys), array of strings jako JSONB
    file_keys         JSONB           NOT NULL DEFAULT '[]'::jsonb,

    -- iDoklad integrace
    idoklad_id        VARCHAR(64)     NULL,

    client_version    BIGINT          NOT NULL DEFAULT 1,
    created_at        TIMESTAMPTZ     NOT NULL DEFAULT now(),
    updated_at        TIMESTAMPTZ     NOT NULL DEFAULT now(),
    deleted_at        TIMESTAMPTZ     NULL
);
CREATE INDEX idx_invoices_profile_date ON invoices (profile_id, issue_date DESC) WHERE deleted_at IS NULL;
CREATE INDEX idx_invoices_paid ON invoices (profile_id, paid) WHERE deleted_at IS NULL;
CREATE INDEX idx_invoices_updated ON invoices (profile_id, updated_at);

CREATE TABLE invoice_items (
    id                UUID            PRIMARY KEY DEFAULT gen_random_uuid(),
    sync_id           UUID            NOT NULL UNIQUE,
    invoice_id        UUID            NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,

    name              VARCHAR(256)    NOT NULL,
    quantity          NUMERIC(10,3)   NOT NULL DEFAULT 1,
    unit_price_with_vat NUMERIC(18,2) NULL,
    total_price_with_vat NUMERIC(18,2) NOT NULL,
    vat_rate          NUMERIC(5,2)    NULL,
    position          INTEGER         NOT NULL DEFAULT 0,

    client_version    BIGINT          NOT NULL DEFAULT 1,
    created_at        TIMESTAMPTZ     NOT NULL DEFAULT now(),
    updated_at        TIMESTAMPTZ     NOT NULL DEFAULT now(),
    deleted_at        TIMESTAMPTZ     NULL
);
CREATE INDEX idx_invoice_items_invoice ON invoice_items (invoice_id) WHERE deleted_at IS NULL;

-- ─── Files (object storage metadata) ───────────────────────────────
-- Soubory samotné žijí v MinIO / S3. Zde je jen metadata pro audit.
CREATE TABLE files (
    id                UUID            PRIMARY KEY DEFAULT gen_random_uuid(),
    owner_user_id     UUID            NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    storage_key       VARCHAR(512)    NOT NULL UNIQUE,
    content_type      VARCHAR(128)    NOT NULL,
    size_bytes        BIGINT          NULL,
    purpose           VARCHAR(32)     NOT NULL,    -- 'receipt' | 'invoice' | 'warranty' | 'avatar'
    uploaded_at       TIMESTAMPTZ     NULL,
    created_at        TIMESTAMPTZ     NOT NULL DEFAULT now()
);
CREATE INDEX idx_files_owner ON files (owner_user_id);

-- ─── Updated_at triggery ───────────────────────────────────────────
CREATE TRIGGER profiles_updated_at     BEFORE UPDATE ON profiles     FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER accounts_updated_at     BEFORE UPDATE ON accounts     FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER categories_updated_at   BEFORE UPDATE ON categories   FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER transactions_updated_at BEFORE UPDATE ON transactions FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER receipts_updated_at     BEFORE UPDATE ON receipts     FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER receipt_items_updated_at BEFORE UPDATE ON receipt_items FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER invoices_updated_at     BEFORE UPDATE ON invoices     FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER invoice_items_updated_at BEFORE UPDATE ON invoice_items FOR EACH ROW EXECUTE FUNCTION set_updated_at();
