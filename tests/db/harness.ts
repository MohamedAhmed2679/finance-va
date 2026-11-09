/**
 * A real Postgres (PGlite, in-process) with every Supabase migration applied, plus the small
 * parts of Supabase the migrations rely on (auth.uid(), roles, storage tables).
 * Used to test row-level security and database functions. Test data only lives in memory.
 */
import { PGlite } from '@electric-sql/pglite';
import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';

const MIGRATIONS = join(__dirname, '../../supabase/migrations');

const SUPABASE_STUBS = `
CREATE ROLE anon NOLOGIN; CREATE ROLE authenticated NOLOGIN; CREATE ROLE service_role NOLOGIN BYPASSRLS;
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO anon, authenticated, service_role;
CREATE SCHEMA auth; GRANT USAGE ON SCHEMA auth TO anon, authenticated, service_role;
CREATE TABLE auth.users (id UUID PRIMARY KEY, email TEXT, phone TEXT, email_confirmed_at TIMESTAMPTZ, raw_user_meta_data JSONB DEFAULT '{}'::jsonb, created_at TIMESTAMPTZ DEFAULT now());
CREATE FUNCTION auth.uid() RETURNS UUID LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
CREATE FUNCTION auth.role() RETURNS TEXT LANGUAGE sql STABLE AS $$ SELECT coalesce(nullif(current_setting('request.jwt.claim.role', true), ''), 'anon') $$;
CREATE FUNCTION auth.jwt() RETURNS JSONB LANGUAGE sql STABLE AS $$ SELECT coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb $$;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA auth TO anon, authenticated, service_role;
GRANT SELECT ON auth.users TO service_role;
CREATE SCHEMA storage; GRANT USAGE ON SCHEMA storage TO anon, authenticated, service_role;
CREATE TABLE storage.buckets (id TEXT PRIMARY KEY, name TEXT, public BOOLEAN DEFAULT FALSE, file_size_limit BIGINT, allowed_mime_types TEXT[]);
CREATE TABLE storage.objects (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), bucket_id TEXT REFERENCES storage.buckets(id), name TEXT, owner UUID, created_at TIMESTAMPTZ DEFAULT now(), metadata JSONB);
ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;
GRANT ALL ON storage.objects, storage.buckets TO authenticated, service_role;
CREATE FUNCTION storage.foldername(name TEXT) RETURNS TEXT[] LANGUAGE sql IMMUTABLE AS $$ SELECT (string_to_array(name, '/'))[1:array_length(string_to_array(name, '/'), 1) - 1] $$;
CREATE PUBLICATION supabase_realtime;
`;

export interface TestDb {
    db: PGlite;
    /** Runs SQL as a signed-in user (RLS applies), or as the service role. */
    as: <T = Record<string, unknown>>(who: string | 'service', sql: string, params?: unknown[]) => Promise<T[]>;
    /** Creates an auth user + public.users row (as the user, the way the app does). */
    signUp: (email: string, extra?: Record<string, unknown>) => Promise<{ authId: string; userId: string }>;
    applied: string[];
    skipped: { file: string; error: string }[];
}

export async function createTestDb(): Promise<TestDb> {
    const db = new PGlite();
    await db.exec(SUPABASE_STUBS);
    const applied: string[] = [], skipped: { file: string; error: string }[] = [];
    for (const f of readdirSync(MIGRATIONS).filter(f => f.endsWith('.sql')).sort()) {
        try { await db.exec(readFileSync(join(MIGRATIONS, f), 'utf8')); applied.push(f); }
        catch (e) { skipped.push({ file: f, error: (e as Error).message }); }
    }
    // Make sure every table created by migrations is usable by the API roles (Supabase grants these).
    // Functions get EXECUTE from the default privileges above, exactly as on Supabase, so a migration's
    // REVOKE stays in force here too (re-granting them all would hide functions that should be locked).
    await db.exec(`GRANT ALL ON ALL TABLES IN SCHEMA public TO anon, authenticated, service_role;`);

    const as = async <T,>(who: string, sql: string, params: unknown[] = []) => {
        return await db.transaction(async tx => {
            if (who === 'service') {
                await tx.exec(`SET LOCAL ROLE service_role; SELECT set_config('request.jwt.claim.role', 'service_role', true);`);
            } else {
                await tx.query(`SELECT set_config('request.jwt.claim.sub', $1, true), set_config('request.jwt.claim.role', 'authenticated', true)`, [who]);
                await tx.exec('SET LOCAL ROLE authenticated');
            }
            const r = await tx.query<T>(sql, params);
            return r.rows;
        });
    };
    const signUp = async (email: string, extra: Record<string, unknown> = {}) => {
        const authId = (await db.query<{ id: string }>('SELECT gen_random_uuid() AS id')).rows[0].id;
        await db.query('INSERT INTO auth.users (id, email, email_confirmed_at) VALUES ($1, $2, now())', [authId, email]);
        // The on_auth_user_created trigger makes the profile row, like in Supabase
        const [row] = await as<{ id: string }>('service', 'SELECT id FROM public.users WHERE auth_id = $1', [authId]);
        for (const [k, v] of Object.entries(extra)) await as(authId, `UPDATE public.users SET ${k} = $1 WHERE auth_id = $2`, [v, authId]);
        return { authId, userId: row.id };
    };
    return { db, as, signUp, applied, skipped };
}
