/**
 * Support requests: a numbered request with a category, severity and status, and the messages in it.
 * Rules are enforced in the database (migration v29): people see and open only their own requests,
 * can close and reopen them, and can never edit a message or post as the Zaylo team.
 */
import { supabase, isSupabaseReady } from '../lib/supabase';
import { useStore } from '../store/useStore';
import { uploadChatFiles, type Attachment } from './chatFiles';

export type RequestStatus = 'open' | 'waiting_on_you' | 'resolved' | 'closed';
export type Severity = 'low' | 'normal' | 'high' | 'urgent';

export interface SupportRequest {
    id: string; number: number; category: string; subject: string; severity: Severity; status: RequestStatus;
    confidential: boolean; related_feature: string | null; related_ref: string | null;
    created_at: string; updated_at: string; closed_at: string | null;
}
export interface SupportMessage { id: string; user_id: string; request_id: string | null; from_admin: boolean; sender_name: string; body: string; created_at: string; read_at: string | null; attachments?: (Attachment & { localUrl?: string })[] }

export const CATEGORIES: { key: string; label: string }[] = [
    { key: 'account', label: 'Account and sign-in' },
    { key: 'expenses_income', label: 'Expenses and income' },
    { key: 'bills_savings', label: 'Bills and savings' },
    { key: 'smart_cart', label: 'Smart Cart' },
    { key: 'autotrack', label: 'AutoTrack' },
    { key: 'workspaces', label: 'Workspaces and sharing' },
    { key: 'sync_backup', label: 'Syncing, backup and export' },
    { key: 'ai_assistant', label: 'Zaylo AI' },
    { key: 'feedback', label: 'Suggestion or feedback' },
    { key: 'other', label: 'Something else' },
];
export const SECURITY_CATEGORIES: { key: string; label: string; hint: string }[] = [
    { key: 'sec_account_compromise', label: 'Someone else may have access to my account', hint: 'For example: a sign-in you don\'t recognise, or your email or password changed without you.' },
    { key: 'sec_suspicious_activity', label: 'Suspicious activity', hint: 'For example: a message or call claiming to be from Zaylo, or an invitation you didn\'t expect.' },
    { key: 'sec_unauthorized_record', label: 'A record I didn\'t create', hint: 'An expense, income, bill or member that appeared without you adding it.' },
    { key: 'sec_privacy', label: 'Privacy concern', hint: 'A question or complaint about how your personal data is used, or a request to access or erase it.' },
    { key: 'sec_vulnerability', label: 'Security weakness in Zaylo', hint: 'A flaw you found that could expose data or let someone bypass a protection.' },
];
export const categoryLabel = (key: string) => [...CATEGORIES, ...SECURITY_CATEGORIES].find(c => c.key === key)?.label || key;

export const STATUS_LABEL: Record<RequestStatus, string> = { open: 'Open', waiting_on_you: 'Waiting for your reply', resolved: 'Resolved', closed: 'Closed' };
export const SEVERITIES: { key: Severity; label: string; hint: string }[] = [
    { key: 'low', label: 'Low', hint: 'A question or suggestion' },
    { key: 'normal', label: 'Normal', hint: 'Something isn\'t working as expected' },
    { key: 'high', label: 'High', hint: 'I can\'t use an important feature' },
    { key: 'urgent', label: 'Urgent', hint: 'I can\'t get into my account or my data looks wrong' },
];

/** Attachments on support requests: screenshots, PDFs and text only, up to 10 MB each. */
export const SUPPORT_ACCEPT = 'image/png,image/jpeg,image/webp,image/heic,application/pdf,text/plain,.csv';
const SUPPORT_TYPES = /^(image\/(png|jpeg|webp|heic|heif)|application\/pdf|text\/plain|text\/csv)$/;
export const SUPPORT_MAX_BYTES = 10 * 1024 * 1024;
export const SUPPORT_MAX_FILES = 5;
export function checkSupportFiles(files: File[]): string | null {
    if (files.length > SUPPORT_MAX_FILES) return `Attach up to ${SUPPORT_MAX_FILES} files.`;
    const bad = files.find(f => !(SUPPORT_TYPES.test(f.type) || /\.(png|jpe?g|webp|heic|pdf|txt|csv)$/i.test(f.name)));
    if (bad) return `${bad.name} can't be attached. Use an image, a PDF or a text file.`;
    const big = files.find(f => f.size > SUPPORT_MAX_BYTES);
    if (big) return `${big.name} is too large. Files can be up to 10 MB.`;
    return null;
}

/** Technical details a person may choose to include. Shown to them in full before sending. No account or financial data. */
export function collectDiagnostics(): Record<string, string | number | boolean> {
    const ua = navigator.userAgent;
    const platform = ua.includes('Electron') ? 'desktop app' : /Android/i.test(ua) ? 'Android' : /iPhone|iPad|iPod/i.test(ua) ? 'iOS' : 'web';
    const s = useStore.getState();
    return {
        appVersion: __APP_VERSION__,
        platform,
        browser: ua.slice(0, 160),
        language: s.user?.language || 'en',
        theme: s.theme,
        online: navigator.onLine,
        syncStatus: s.syncStatus,
        screen: `${window.innerWidth}x${window.innerHeight}`,
        timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone || '',
    };
}

const db = () => { if (!isSupabaseReady() || !supabase) throw new Error('You\'re offline. Connect to the internet to contact support.'); return supabase; };
const me = () => { const id = useStore.getState().user?.dbId; if (!id) throw new Error('Sign in again to contact support.'); return id; };
const COLS = 'id, number, category, subject, severity, status, confidential, related_feature, related_ref, created_at, updated_at, closed_at';

export async function listRequests(): Promise<SupportRequest[]> {
    const { data, error } = await db().from('support_requests').select(COLS).eq('user_id', me()).order('updated_at', { ascending: false }).limit(100);
    if (error) throw new Error(isMissing(error) ? NOT_READY : 'Your requests couldn\'t be loaded. Try again.');
    return (data as SupportRequest[]) || [];
}
export async function getRequest(id: string): Promise<SupportRequest | null> {
    const { data, error } = await db().from('support_requests').select(COLS).eq('id', id).maybeSingle();
    if (error) throw new Error('This request couldn\'t be loaded. Try again.');
    return data as SupportRequest | null;
}

const NOT_READY = 'Support requests aren\'t available yet on this server. Please try again later.';
const isMissing = (e: { code?: string; message?: string }) => e.code === 'PGRST205' || e.code === '42P01' || /support_requests|request_id/.test(e.message || '') && /find|exist|schema cache/.test(e.message || '');

export interface NewRequest { category: string; subject: string; description: string; severity: Severity; relatedFeature?: string; relatedRef?: string; diagnostics?: Record<string, unknown> | null; files?: File[]; confidential?: boolean }

/** Creates the request and its first message. Uses client-made ids, so a retry after a dropped connection can't create it twice. */
export async function createRequest(input: NewRequest, ids: { requestId: string; messageId: string }, onProgress?: (n: number) => void): Promise<SupportRequest> {
    const user = me();
    let attachments: Attachment[] = [];
    if (input.files?.length) attachments = await uploadChatFiles(`support/${user}`, input.files, n => onProgress?.(n));
    const row = {
        id: ids.requestId, user_id: user, category: input.category, subject: input.subject.trim(), severity: input.severity,
        confidential: Boolean(input.confidential) || input.category.startsWith('sec_'),
        related_feature: input.relatedFeature || null, related_ref: input.relatedRef?.trim() || null, diagnostics: input.diagnostics || null,
    };
    const { error } = await db().from('support_requests').upsert(row, { onConflict: 'id', ignoreDuplicates: true });
    if (error) throw new Error(isMissing(error) ? NOT_READY : /too many requests/i.test(error.message || '') ? 'You\'ve sent several requests in a short time. Add to one of your open requests, or try again in an hour.' : 'Your request wasn\'t sent. Check your connection and try again.');
    const msg: Record<string, unknown> = { id: ids.messageId, user_id: user, request_id: ids.requestId, body: input.description.trim(), sender_name: useStore.getState().user?.name || '' };
    if (attachments.length) msg.attachments = attachments;
    const { error: e2 } = await db().from('support_messages').upsert(msg, { onConflict: 'id', ignoreDuplicates: true });
    if (e2) throw new Error('Your request was opened, but its description wasn\'t saved. Open the request and send the details again.');
    const saved = await getRequest(ids.requestId);
    if (!saved) throw new Error('Your request wasn\'t sent. Check your connection and try again.');
    return saved;
}

/** Messages of one request, or (requestId null) the earlier free-form conversation. */
export async function listMessages(requestId: string | null): Promise<SupportMessage[]> {
    let q = db().from('support_messages').select('*').eq('user_id', me()).order('created_at').limit(500);
    q = requestId ? q.eq('request_id', requestId) : q.is('request_id', null);
    const { data, error } = await q;
    if (error) {
        if (!requestId && isMissing(error)) {   // database not upgraded yet: every message is the earlier conversation
            const r = await db().from('support_messages').select('*').eq('user_id', me()).order('created_at').limit(500);
            return (r.data as SupportMessage[]) || [];
        }
        throw new Error('Messages couldn\'t be loaded. Try again.');
    }
    const rows = (data as SupportMessage[]) || [];
    const unread = rows.filter(m => m.from_admin && !m.read_at).map(m => m.id);
    if (unread.length) db().from('support_messages').update({ read_at: new Date().toISOString() }).in('id', unread).then(() => {});
    return rows;
}

export async function sendReply(requestId: string | null, id: string, body: string, files: File[], onProgress?: (n: number) => void): Promise<Attachment[]> {
    const user = me();
    let attachments: Attachment[] = [];
    if (files.length) attachments = await uploadChatFiles(`support/${user}`, files, n => onProgress?.(n));
    const row: Record<string, unknown> = { id, user_id: user, body, sender_name: useStore.getState().user?.name || '' };
    if (requestId) row.request_id = requestId;
    if (attachments.length) row.attachments = attachments;
    const { error } = await db().from('support_messages').insert(row);
    if (error) throw new Error('Message didn\'t send. Try again.');
    return attachments;
}

export async function closeRequest(id: string) { const { error } = await db().rpc('close_support_request', { p_id: id }); if (error) throw new Error('The request couldn\'t be closed. Try again.'); }
export async function reopenRequest(id: string) { const { error } = await db().rpc('reopen_support_request', { p_id: id }); if (error) throw new Error('The request couldn\'t be reopened. Try again.'); }

/** Feedback on an AI answer. The answer text is included only when the person reports it. */
export async function sendAiFeedback(rating: 'helpful' | 'not_helpful' | 'reported', opts: { reason?: string; answer?: string } = {}) {
    const { error } = await db().from('ai_feedback').insert({ user_id: me(), surface: 'assistant', rating, reason: opts.reason?.slice(0, 500) || null, answer_excerpt: rating === 'reported' ? (opts.answer || '').slice(0, 1200) : null });
    if (error) throw new Error('Your feedback couldn\'t be saved. Try again.');
}
