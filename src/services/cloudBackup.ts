/**
 * Monthly backups.
 *
 *  - Google Drive and OneDrive: connected once, then the server uploads a backup on the 1st of every
 *    month (api/backup.ts), even when the app is closed.
 *  - iCloud Drive (and any other synced folder on a computer): Apple has no web API for iCloud Drive, so
 *    the Mac / Windows app saves the monthly files into the iCloud Drive folder, which syncs on its own.
 *    On iPhone and iPad the files go to the share sheet (Save to Files → iCloud Drive).
 */
import { Capacitor } from '@capacitor/core';
import { supabase } from '../lib/supabase';
import { deliverFiles, MIME } from './reports';

const API_BASE = import.meta.env.VITE_API_BASE ?? '';
export type CloudProvider = 'google' | 'microsoft';

export interface CloudConnection {
    provider: CloudProvider;
    accountEmail: string | null;
    lastBackupAt: string | null;
    lastBackupMonth: string | null;
    lastFiles: { name: string; url: string }[];
    lastError: string | null;
}
export interface CloudStatus {
    providers: Record<CloudProvider, boolean>;
    connections: CloudConnection[];
    setupNeeded?: 'database';
}

async function call<T = Record<string, unknown>>(body: object): Promise<T> {
    const { data } = (await supabase?.auth.getSession()) || { data: { session: null } };
    const res = await fetch(`${API_BASE}/api/backup`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(data.session ? { Authorization: `Bearer ${data.session.access_token}` } : {}) },
        body: JSON.stringify(body),
    });
    const out = await res.json().catch(() => ({}));
    if (!res.ok && !out.setupNeeded) throw Object.assign(new Error(out.error || `Backup error ${res.status}`), { setupNeeded: out.setupNeeded });
    if (!res.ok) throw Object.assign(new Error(out.error || 'Not set up yet'), { setupNeeded: out.setupNeeded });
    return out;
}

export const cloudStatus = () => call<CloudStatus>({ action: 'status' });
export const disconnectCloud = (provider: CloudProvider) => call({ action: 'disconnect', provider });
export const backupNow = (provider?: CloudProvider) => call<{ results: { provider: CloudProvider; ok: boolean; error?: string; files?: { name: string; url: string }[] }[] }>({ action: 'backup_now', provider });

export const isElectron = () => typeof window !== 'undefined' && Boolean((window as unknown as { ipcRenderer?: unknown }).ipcRenderer) && /Electron/i.test(navigator.userAgent);
const ipc = () => (window as unknown as { ipcRenderer: { invoke: (ch: string, ...a: unknown[]) => Promise<unknown> } }).ipcRenderer;

/** Opens Google / Microsoft sign-in. In the apps it opens the system browser (Google blocks sign-in inside apps). */
export async function connectCloud(provider: CloudProvider) {
    const { url } = await call<{ url: string }>({ action: 'connect', provider, returnTo: '/settings' });
    if (Capacitor.isNativePlatform()) {
        const { Browser } = await import('@capacitor/browser');
        await Browser.open({ url });
        return 'external';
    }
    if (isElectron()) { window.open(url, '_blank'); return 'external'; }
    window.location.href = url;
    return 'redirect';
}

/** This month's (or a given month's) backup files, built by the server from everything in the account. */
export async function backupFilesFor(month?: string) {
    const out = await call<{ files: { name: string; mime: string; base64: string }[] }>({ action: 'export', month });
    return out.files.map(f => ({ name: f.name, mime: f.mime || (f.name.endsWith('.pdf') ? MIME.pdf : MIME.xlsx), bytes: Uint8Array.from(atob(f.base64), c => c.charCodeAt(0)) }));
}

/** iPhone / iPad / Android: hand the backup to the share sheet (Save to Files → iCloud Drive). */
export async function shareBackupNow() {
    const files = await backupFilesFor();
    return deliverFiles(files, { share: true });
}

// ------------------------------------------------------------- desktop app: synced folders

export interface SyncFolder { key: 'icloud' | 'onedrive' | 'gdrive' | 'dropbox'; label: string; path: string }
export interface DesktopBackupPref { folderKey: SyncFolder['key']; lastMonth?: string; lastSavedAt?: string; lastPath?: string }
const PREF_KEY = 'zaylo_desktop_backup_v1';

export async function desktopSyncFolders(): Promise<SyncFolder[]> {
    if (!isElectron()) return [];
    try { return (await ipc().invoke('zaylo:sync-folders')) as SyncFolder[]; } catch { return []; }
}
export function desktopBackupPref(): DesktopBackupPref | null {
    try { return JSON.parse(localStorage.getItem(PREF_KEY) || 'null'); } catch { return null; }
}
export function setDesktopBackupPref(p: DesktopBackupPref | null) {
    try { if (p) localStorage.setItem(PREF_KEY, JSON.stringify(p)); else localStorage.removeItem(PREF_KEY); } catch { /* private mode */ }
}

const prevMonth = (d = new Date()) => { const x = new Date(d.getFullYear(), d.getMonth() - 1, 1); return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}`; };
const toB64 = (b: Uint8Array) => { let s = ''; for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode(...b.subarray(i, i + 0x8000)); return btoa(s); };

/** Saves backup files into the chosen synced folder (in "Zaylo Backups"). */
export async function saveToDesktopFolder(folderKey: SyncFolder['key'], month?: string) {
    const files = await backupFilesFor(month);
    const res = (await ipc().invoke('zaylo:save-files', { folderKey, files: files.map(f => ({ name: f.name, base64: toB64(f.bytes) })) })) as { ok: boolean; dir?: string; error?: string };
    if (!res.ok) throw new Error(res.error || 'Couldn\'t save the backup');
    return res.dir!;
}
export const openDesktopFolder = (dir: string) => ipc().invoke('zaylo:open-path', dir).catch(() => {});

/** Desktop app start-up: if last month hasn't been saved yet, save it now. */
export async function desktopMonthlyCatchUp() {
    if (!isElectron()) return null;
    const pref = desktopBackupPref();
    const month = prevMonth();
    if (!pref || (pref.lastMonth && pref.lastMonth >= month)) return null;
    const dir = await saveToDesktopFolder(pref.folderKey, month);
    setDesktopBackupPref({ ...pref, lastMonth: month, lastSavedAt: new Date().toISOString(), lastPath: dir });
    return { month, dir };
}
