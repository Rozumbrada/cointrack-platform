-- Sprint 5f — Per-profile permissions.
--
-- Umoznuje adminovi organizace dat memberovi pristup jen k vybranym profilum
-- v ramci organizace (bez teto tabulky member vidi jen sve vlastni profily).
--
-- Owner/admin orgu maji vzdy implicitni plny pristup ke vsem profilum orgu
-- a tato tabulka se pro ne nepouziva.

CREATE TABLE profile_permissions (
    id                  UUID            PRIMARY KEY DEFAULT gen_random_uuid(),
    profile_id          UUID            NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    user_id             UUID            NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    permission          VARCHAR(16)     NOT NULL,    -- 'view' / 'edit'
    granted_by_user_id  UUID            NULL REFERENCES users(id) ON DELETE SET NULL,
    granted_at          TIMESTAMPTZ     NOT NULL DEFAULT now(),
    UNIQUE (profile_id, user_id)
);
CREATE INDEX idx_profile_permissions_user    ON profile_permissions (user_id);
CREATE INDEX idx_profile_permissions_profile ON profile_permissions (profile_id);
