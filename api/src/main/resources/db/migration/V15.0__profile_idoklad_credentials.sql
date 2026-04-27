-- V15.0 — iDoklad credentials a cache na Profile.
--
-- Před touto migrací mobil ukládal Client ID + Secret jen lokálně. Web nemá kde
-- bezpečně držet Client Secret v browseru, proto je přesouváme na server:
--
--   • client_id           — plaintext, není citlivý sám o sobě
--   • client_secret_enc   — AES-GCM ciphertext (nonce ‖ ciphertext ‖ tag), base64
--   • access_token        — cache OAuth access tokenu (1h platnost)
--   • token_expires_at    — kdy expiruje access token
--
-- Šifrování: master key je v env.IDOKLAD_ENC_KEY (32 bajtů base64).
-- Mobile při migraci pošle své lokální creds přes endpoint /api/v1/idoklad/credentials.

ALTER TABLE profiles ADD COLUMN idoklad_client_id          VARCHAR(128);
ALTER TABLE profiles ADD COLUMN idoklad_client_secret_enc  TEXT;
ALTER TABLE profiles ADD COLUMN idoklad_access_token       TEXT;
ALTER TABLE profiles ADD COLUMN idoklad_token_expires_at   TIMESTAMPTZ;
ALTER TABLE profiles ADD COLUMN idoklad_last_sync_at       TIMESTAMPTZ;
