-- Sprint 5e — Organizations & members (B2B model).
--
-- Organization vzniká až po zakoupení Organization planu (zatím bez billingu,
-- všechny orgy fungují. Gating se napojí v pozdějším sprintu s billingem).
--
-- Profil nově může mít `organization_id`. NULL = osobní profil (stávající chování).
-- Uvnitř orgu profil vlastní konkrétní user (`owner_user_id`), admin/owner org
-- mají přístup ke všem profilům v orgu. Členové jen k vlastním (+ per-profile
-- permissions přidáme v 5f).

CREATE TABLE organizations (
    id                UUID            PRIMARY KEY DEFAULT gen_random_uuid(),
    name              VARCHAR(256)    NOT NULL,
    owner_user_id     UUID            NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    plan_tier         VARCHAR(32)     NOT NULL DEFAULT 'organization',
    max_free_members  INTEGER         NOT NULL DEFAULT 5,
    created_at        TIMESTAMPTZ     NOT NULL DEFAULT now(),
    updated_at        TIMESTAMPTZ     NOT NULL DEFAULT now(),
    deleted_at        TIMESTAMPTZ     NULL
);
CREATE INDEX idx_organizations_owner ON organizations (owner_user_id) WHERE deleted_at IS NULL;

CREATE TABLE organization_members (
    id                UUID            PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id   UUID            NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    user_id           UUID            NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    role              VARCHAR(16)     NOT NULL DEFAULT 'member',   -- owner / admin / member
    joined_at         TIMESTAMPTZ     NOT NULL DEFAULT now(),
    UNIQUE (organization_id, user_id)
);
CREATE INDEX idx_org_members_user ON organization_members (user_id);
CREATE INDEX idx_org_members_org  ON organization_members (organization_id);

CREATE TABLE organization_invites (
    id                UUID            PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id   UUID            NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    email             VARCHAR(255)    NOT NULL,
    token_hash        VARCHAR(128)    NOT NULL UNIQUE,
    role              VARCHAR(16)     NOT NULL DEFAULT 'member',
    invited_by_user_id UUID           NOT NULL REFERENCES users(id) ON DELETE SET NULL,
    expires_at        TIMESTAMPTZ     NOT NULL,
    accepted_at       TIMESTAMPTZ     NULL,
    revoked_at        TIMESTAMPTZ     NULL,
    created_at        TIMESTAMPTZ     NOT NULL DEFAULT now()
);
CREATE INDEX idx_org_invites_org   ON organization_invites (organization_id) WHERE accepted_at IS NULL AND revoked_at IS NULL;
CREATE INDEX idx_org_invites_email ON organization_invites (lower(email))    WHERE accepted_at IS NULL AND revoked_at IS NULL;

-- Rozšíření profiles o organization_id
ALTER TABLE profiles
    ADD COLUMN organization_id UUID NULL REFERENCES organizations(id) ON DELETE SET NULL;

CREATE INDEX idx_profiles_organization ON profiles (organization_id) WHERE deleted_at IS NULL;
