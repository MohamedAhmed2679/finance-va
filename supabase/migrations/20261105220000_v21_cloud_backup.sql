-- v21: monthly cloud backups to Google Drive and OneDrive.
-- Only the server (service role) reads or writes this table: it holds encrypted refresh tokens.

CREATE TABLE IF NOT EXISTS public.cloud_connections (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    provider TEXT NOT NULL CHECK (provider IN ('google', 'microsoft')),
    account_email TEXT,
    refresh_token_enc TEXT NOT NULL,        -- AES-256-GCM, key held by the server only
    folder_id TEXT,                         -- Google Drive folder id ("Zaylo Backups")
    last_backup_at TIMESTAMPTZ,
    last_backup_month TEXT,                 -- 'YYYY-MM' of the month most recently backed up
    last_files JSONB,                       -- [{ name, url }]
    last_error TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (user_id, provider)
);
CREATE INDEX IF NOT EXISTS idx_cloud_connections_due ON public.cloud_connections(last_backup_month);
ALTER TABLE public.cloud_connections ENABLE ROW LEVEL SECURITY;
-- No policies on purpose: signed-in users cannot read tokens. The app asks /api/backup for status.
REVOKE ALL ON public.cloud_connections FROM anon, authenticated;

SELECT 'v21 ok' AS result;
