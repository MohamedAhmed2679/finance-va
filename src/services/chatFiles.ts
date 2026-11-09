/**
 * Chat attachments: private Supabase Storage bucket `chat-attachments`.
 *   workspace chat → <workspace_id>/<uuid>-<name>
 *   support        → support/<users.id>/<uuid>-<name>
 * Files are read through short-lived signed URLs.
 */
import { supabase } from '../lib/supabase';

export const CHAT_BUCKET = 'chat-attachments';
export const MAX_FILE_BYTES = 50 * 1024 * 1024;
export const MAX_FILES = 10;
export const ACCEPT = 'image/*,video/*,audio/*,application/pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.csv,.txt,.zip';

export interface Attachment { path: string; name: string; type: string; size: number }
export type AttachmentKind = 'image' | 'video' | 'audio' | 'pdf' | 'file';

export function kindOf(a: { type: string; name: string }): AttachmentKind {
    if (a.type.startsWith('image/')) return 'image';
    if (a.type.startsWith('video/')) return 'video';
    if (a.type.startsWith('audio/')) return 'audio';
    if (a.type === 'application/pdf' || /\.pdf$/i.test(a.name)) return 'pdf';
    return 'file';
}

export function formatBytes(n: number) {
    if (n < 1024) return `${n} B`;
    if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
    return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

const safeName = (name: string) => name.normalize('NFKD').replace(/[^\w.-]+/g, '_').replace(/_+/g, '_').slice(-80) || 'file';

/** Returns a message for files that can't be sent, or null when all are fine. */
export function checkFiles(files: File[]): string | null {
    if (files.length > MAX_FILES) return `Send up to ${MAX_FILES} files at a time.`;
    const big = files.find(f => f.size > MAX_FILE_BYTES);
    if (big) return `${big.name} is ${formatBytes(big.size)}. Files can be up to 50 MB.`;
    return null;
}

export async function uploadChatFiles(prefix: string, files: File[], onProgress?: (done: number) => void): Promise<Attachment[]> {
    if (!supabase) throw new Error('Not connected');
    const out: Attachment[] = [];
    for (const f of files) {
        const path = `${prefix}/${crypto.randomUUID()}-${safeName(f.name)}`;
        const { error } = await supabase.storage.from(CHAT_BUCKET).upload(path, f, { contentType: f.type || 'application/octet-stream', upsert: false });
        if (error) {
            if (/bucket not found/i.test(error.message)) throw new Error('Attachments need the latest database update.');
            if (/row-level security|unauthorized/i.test(error.message)) throw new Error("You can't upload files to this chat.");
            throw new Error(`${f.name} didn't upload. ${error.message}`);
        }
        out.push({ path, name: f.name, type: f.type || 'application/octet-stream', size: f.size });
        onProgress?.(out.length);
    }
    return out;
}

const cache = new Map<string, { url: string; exp: number }>();
const TTL = 60 * 60; // seconds

/** Signed URLs for many paths at once, cached until shortly before they expire. */
export async function signedUrls(paths: string[]): Promise<Record<string, string>> {
    const now = Date.now();
    const result: Record<string, string> = {};
    const missing: string[] = [];
    paths.forEach(p => { const c = cache.get(p); if (c && c.exp > now) result[p] = c.url; else missing.push(p); });
    if (missing.length && supabase) {
        for (let i = 0; i < missing.length; i += 100) {
            const chunk = missing.slice(i, i + 100);
            const { data } = await supabase.storage.from(CHAT_BUCKET).createSignedUrls(chunk, TTL);
            (data || []).forEach(d => {
                if (d.signedUrl && d.path) { cache.set(d.path, { url: d.signedUrl, exp: now + (TTL - 120) * 1000 }); result[d.path] = d.signedUrl; }
            });
        }
    }
    return result;
}

export function downloadUrl(url: string, name: string) {
    return `${url}${url.includes('?') ? '&' : '?'}download=${encodeURIComponent(name)}`;
}
