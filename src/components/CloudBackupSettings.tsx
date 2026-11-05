import { useCallback, useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { Cloud, FolderOpen, Loader2, RefreshCw, Share2, Unplug } from 'lucide-react';
import { tx } from '../i18n/translations';
import { useStore } from '../store/useStore';
import {
    backupNow, cloudStatus, connectCloud, desktopBackupPref, desktopSyncFolders, disconnectCloud, isElectron, openDesktopFolder,
    saveToDesktopFolder, setDesktopBackupPref, shareBackupNow, type CloudProvider, type CloudStatus, type SyncFolder,
} from '../services/cloudBackup';
import { Capacitor } from '@capacitor/core';

const GoogleDriveIcon = () => (
    <svg viewBox="0 0 87.3 78" width="26" height="24" aria-hidden><path d="m6.6 66.85 3.85 6.65c.8 1.4 1.95 2.5 3.3 3.3l13.75-23.8h-27.5c0 1.55.4 3.1 1.2 4.5z" fill="#0066da" /><path d="m43.65 25-13.75-23.8c-1.35.8-2.5 1.9-3.3 3.3l-25.4 44a9.06 9.06 0 0 0 -1.2 4.5h27.5z" fill="#00ac47" /><path d="m73.55 76.8c1.35-.8 2.5-1.9 3.3-3.3l1.6-2.75 7.65-13.25c.8-1.4 1.2-2.95 1.2-4.5h-27.502l5.852 11.5z" fill="#ea4335" /><path d="m43.65 25 13.75-23.8c-1.35-.8-2.9-1.2-4.5-1.2h-18.5c-1.6 0-3.15.45-4.5 1.2z" fill="#00832d" /><path d="m59.8 53h-32.3l-13.75 23.8c1.35.8 2.9 1.2 4.5 1.2h50.8c1.6 0 3.15-.45 4.5-1.2z" fill="#2684fc" /><path d="m73.4 26.5-12.7-22c-.8-1.4-1.95-2.5-3.3-3.3l-13.75 23.8 16.15 28h27.45c0-1.55-.4-3.1-1.2-4.5z" fill="#ffba00" /></svg>
);
const OneDriveIcon = () => (
    <svg viewBox="0 0 24 24" width="26" height="24" aria-hidden fill="#0078D4"><path d="M19.5 8c-.1 0-.3 0-.4 0-.4-3.3-3.2-5.9-6.6-5.9-2.3 0-4.3 1.2-5.4 3-.3-.1-.7-.1-1.1-.1C3.5 5 1.5 7 1.5 9.5S3.5 14 6 14h13.5c2.5 0 4.5-2 4.5-4.5S22 8 19.5 8z" transform="translate(0 4)" /></svg>
);

const NAMES: Record<CloudProvider, string> = { google: 'Google Drive', microsoft: 'Microsoft OneDrive' };
const fmtDate = (iso: string | null, lang: string) => (iso ? new Date(iso).toLocaleDateString(lang === 'ar' ? 'ar-u-nu-latn' : 'en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '');

/** Settings → Cloud backup: Google Drive / OneDrive (server, monthly) and iCloud Drive (apps). */
export default function CloudBackupSettings() {
    const lang = useStore(s => s.user?.language ?? 'en');
    const [status, setStatus] = useState<CloudStatus | null>(null);
    const [loadErr, setLoadErr] = useState('');
    const [busy, setBusy] = useState<string>('');
    const [folders, setFolders] = useState<SyncFolder[]>([]);
    const [pref, setPref] = useState(desktopBackupPref());
    const desktop = isElectron();
    const apple = /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.userAgent.includes('Macintosh') && 'ontouchend' in document) || Capacitor.getPlatform() === 'ios';
    const phoneApp = Capacitor.isNativePlatform();

    const refresh = useCallback(() => {
        cloudStatus().then(s => { setStatus(s); setLoadErr(''); }).catch(e => setLoadErr((e as Error).message));
    }, []);

    useEffect(() => {
        refresh();
        if (desktop) desktopSyncFolders().then(setFolders);
        // Sign-in happens in the system browser in the apps; pick the result up when the user comes back
        const onFocus = () => { if (document.visibilityState === 'visible') refresh(); };
        document.addEventListener('visibilitychange', onFocus);
        window.addEventListener('focus', onFocus);
        return () => { document.removeEventListener('visibilitychange', onFocus); window.removeEventListener('focus', onFocus); };
    }, [refresh, desktop]);

    // Back from Google / Microsoft sign-in
    useEffect(() => {
        const q = new URLSearchParams(window.location.search);
        const ok = q.get('cloud_connected'), err = q.get('cloud_error');
        if (ok) toast.success(q.get('cloud_first') === 'failed' ? tx('Connected. The first backup didn\'t go through; try Back up now.') : `${tx('Connected')}: ${tx(NAMES[ok as CloudProvider] || ok)}. ${tx('Your first backup is there now.')}`, { duration: 6000 });
        if (err) toast.error(err, { duration: 8000 });
        if (ok || err) window.history.replaceState(null, '', window.location.pathname);
    }, []);

    async function connect(p: CloudProvider) {
        setBusy(`connect:${p}`);
        try {
            const how = await connectCloud(p);
            if (how === 'external') toast(tx('Finish signing in in your browser, then come back here.'), { duration: 7000 });
        } catch (e) { toast.error((e as Error).message); }
        finally { setTimeout(() => setBusy(''), 1500); }
    }
    async function runNow(p: CloudProvider) {
        setBusy(`now:${p}`);
        try {
            const r = await backupNow(p);
            const res = r.results[0];
            if (res?.ok) toast.success(`${tx('Backup saved to')} ${tx(NAMES[p])}`); else toast.error(res?.error || tx('Backup failed'));
            refresh();
        } catch (e) { toast.error((e as Error).message); }
        finally { setBusy(''); }
    }
    async function disconnect(p: CloudProvider) {
        setBusy(`off:${p}`);
        try { await disconnectCloud(p); toast.success(`${tx('Disconnected')}: ${tx(NAMES[p])}`); refresh(); }
        catch (e) { toast.error((e as Error).message); }
        finally { setBusy(''); }
    }
    async function share() {
        setBusy('share');
        try { const how = await shareBackupNow(); if (how === 'downloaded') toast.success(tx('Backup downloaded')); }
        catch (e) { toast.error((e as Error).message); }
        finally { setBusy(''); }
    }
    async function saveDesktop(key: SyncFolder['key']) {
        setBusy('desktop');
        try {
            const dir = await saveToDesktopFolder(key);
            const next = { ...(pref || {}), folderKey: key, lastSavedAt: new Date().toISOString(), lastPath: dir };
            setDesktopBackupPref(next); setPref(next);
            toast.success(tx('Backup saved'));
        } catch (e) { toast.error((e as Error).message); }
        finally { setBusy(''); }
    }
    function chooseFolder(key: SyncFolder['key'] | '') {
        const next = key ? { ...(pref || {}), folderKey: key } : null;
        setDesktopBackupPref(next); setPref(next);
    }

    const conn = (p: CloudProvider) => status?.connections.find(c => c.provider === p);
    const spin = <Loader2 size={15} className="animate-spin" />;

    const providerCard = (p: CloudProvider, icon: React.ReactNode) => {
        const c = conn(p);
        const ready = status?.providers[p];
        return (
            <div className="cloud-card" key={p}>
                <div className="cloud-icon">{icon}</div>
                <div className="cloud-body">
                    <div className="cloud-name">{tx(NAMES[p])}</div>
                    {c ? (
                        <>
                            <div className="cloud-meta"><span translate="no">{c.accountEmail || tx('Connected')}</span></div>
                            <div className="cloud-meta">
                                {c.lastBackupAt ? <>{tx('Last backup')}: {fmtDate(c.lastBackupAt, lang)}</> : tx('No backup yet')}
                                {c.lastFiles?.length ? <> · {c.lastFiles.map((f, i) => <a key={i} href={f.url} target="_blank" rel="noreferrer" translate="no">{f.name.endsWith('.pdf') ? 'PDF' : 'Excel'}</a>).reduce((a: React.ReactNode[], el, i) => (i ? [...a, ' · ', el] : [el]), [])}</> : null}
                            </div>
                            {c.lastError && <div className="cloud-error">{c.lastError}</div>}
                        </>
                    ) : (
                        <div className="cloud-meta">{ready === false ? tx('Not available yet: the server still needs its Google / Microsoft app keys.') : tx('Not connected')}</div>
                    )}
                </div>
                <div className="cloud-actions">
                    {c ? (
                        <>
                            <button className="btn btn-secondary btn-sm" onClick={() => runNow(p)} disabled={!!busy}>{busy === `now:${p}` ? spin : <RefreshCw size={15} />}{tx('Back up now')}</button>
                            <button className="btn btn-ghost btn-sm" onClick={() => disconnect(p)} disabled={!!busy} aria-label={`${tx('Disconnect')} ${tx(NAMES[p])}`}>{busy === `off:${p}` ? spin : <Unplug size={15} />}<span className="hide-sm">{tx('Disconnect')}</span></button>
                        </>
                    ) : (
                        <button className="btn btn-primary btn-sm" onClick={() => connect(p)} disabled={!!busy || !ready || !!status?.setupNeeded}>{busy === `connect:${p}` ? spin : null}{tx('Connect')}</button>
                    )}
                </div>
            </div>
        );
    };

    const icloudFolder = folders.find(f => f.key === 'icloud');
    return (
        <div className="card animate-fadeIn">
            <div style={{ fontWeight: 700, fontSize: 16, marginBottom: 4 }}>{tx('Monthly cloud backup')}</div>
            <div style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 20 }}>
                {tx('On the 1st of every month Zaylo saves two files: an Excel workbook with everything you have recorded, and a PDF report of the month just ended.')}
            </div>

            {status?.setupNeeded === 'database' && <div className="cloud-note warn">{tx('Cloud backup needs a one-time database update before it can be switched on.')}</div>}
            {loadErr && !status && <div className="cloud-note warn">{loadErr}</div>}

            <div className="cloud-list">
                {providerCard('google', <GoogleDriveIcon />)}
                {providerCard('microsoft', <OneDriveIcon />)}

                <div className="cloud-card">
                    <div className="cloud-icon"><Cloud size={24} color="#3693F3" /></div>
                    <div className="cloud-body">
                        <div className="cloud-name">{tx('Apple iCloud Drive')}</div>
                        {desktop ? (
                            folders.length ? (
                                <>
                                    <div className="cloud-meta">{tx('This computer saves the monthly backup into a folder that syncs to your cloud.')}</div>
                                    <select className="form-input form-select" style={{ marginTop: 8, maxWidth: 280 }} value={pref?.folderKey || ''} onChange={e => chooseFolder(e.target.value as SyncFolder['key'] | '')} aria-label={tx('Backup folder')}>
                                        <option value="">{tx('Off')}</option>
                                        {folders.map(f => <option key={f.key} value={f.key}>{tx(f.label)}</option>)}
                                    </select>
                                    {pref?.lastSavedAt && <div className="cloud-meta" style={{ marginTop: 6 }}>{tx('Last backup')}: {fmtDate(pref.lastSavedAt, lang)}</div>}
                                </>
                            ) : <div className="cloud-meta">{tx('iCloud Drive isn\'t set up on this computer. Turn on iCloud Drive (Mac) or install iCloud for Windows.')}</div>
                        ) : apple || phoneApp ? (
                            <div className="cloud-meta">{tx('Save the backup from the share sheet: choose Save to Files, then iCloud Drive.')}</div>
                        ) : (
                            <div className="cloud-meta">{tx('Apple doesn\'t let websites write to iCloud Drive. Use the Zaylo app on your Mac (it saves every month automatically) or on your iPhone.')}</div>
                        )}
                        {desktop && !icloudFolder && folders.length > 0 && <div className="cloud-meta">{tx('iCloud Drive wasn\'t found, but you can use another synced folder.')}</div>}
                    </div>
                    <div className="cloud-actions">
                        {desktop && pref?.folderKey && (
                            <>
                                <button className="btn btn-secondary btn-sm" onClick={() => saveDesktop(pref.folderKey)} disabled={!!busy}>{busy === 'desktop' ? spin : <RefreshCw size={15} />}{tx('Back up now')}</button>
                                {pref.lastPath && <button className="btn btn-ghost btn-sm" onClick={() => openDesktopFolder(pref.lastPath!)} aria-label={tx('Open folder')}><FolderOpen size={15} /></button>}
                            </>
                        )}
                        {!desktop && (apple || phoneApp) && (
                            <button className="btn btn-primary btn-sm" onClick={share} disabled={!!busy}>{busy === 'share' ? spin : <Share2 size={15} />}{tx('Save backup')}</button>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
}
