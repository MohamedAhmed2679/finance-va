/** Deleting the signed-in account (server: api/account.ts, database: delete_account_data). */
import { supabase } from '../lib/supabase';

const API_BASE = import.meta.env.VITE_API_BASE ?? '';

export interface DeletionPreview { deleteWorkspaces: string[]; transferWorkspaces: string[]; leaveWorkspaces: string[] }
export interface DeletionResult { deleted: boolean; signInRemoved: boolean; workspacesDeleted: number; workspacesTransferred: number; warning?: string }

/** What deleting would do, so the person sees it before confirming. */
export async function deletionPreview(): Promise<DeletionPreview | null> {
    if (!supabase) return null;
    const { data, error } = await supabase.rpc('account_deletion_preview');
    if (error) return null;
    return data as DeletionPreview;
}

/** The text the person types to confirm: their email, or DELETE for phone-only accounts. */
export const confirmationText = (email?: string | null) => (email && email.includes('@') ? email.trim().toLowerCase() : 'DELETE');

export async function deleteAccount(confirm: string): Promise<DeletionResult> {
    const { data } = (await supabase?.auth.getSession()) || { data: { session: null } };
    if (!data.session) throw new Error('Sign in again, then try deleting your account.');
    const res = await fetch(`${API_BASE}/api/account`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${data.session.access_token}` },
        body: JSON.stringify({ action: 'delete', confirm }),
    }).catch(() => { throw new Error('You\'re offline. Connect and try again.'); });
    const out = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(out.error || 'Couldn\'t delete your account. Try again.');
    return out as DeletionResult;
}
