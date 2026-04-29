-- V26: per-profile Fio Bank API credentials + sync metadata
--
-- Token je AES-GCM šifrovaný (stejný pattern jako idoklad_client_secret_enc).
-- Plain text nikdy neopouští server. Server volá Fio API
-- (https://www.fio.cz/ib_api/rest) a ukládá transakce do hlavního
-- `transactions` table přes /sync flow.

ALTER TABLE profiles
    ADD COLUMN fio_token_enc      TEXT      NULL,
    ADD COLUMN fio_last_sync_at   TIMESTAMPTZ NULL,
    /** Posledně zpracovaný movement ID — Fio API umožňuje stahovat jen nové
        tx přes endpoint /set-last-id/. Zbavíme se duplicit. */
    ADD COLUMN fio_last_movement_id BIGINT  NULL;
