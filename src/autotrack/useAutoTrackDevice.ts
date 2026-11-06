/**
 * App-wide AutoTrack wiring:
 *  - Android: process alerts the receiver kept (on start, on resume, and when a new one arrives)
 *  - "Share to Zaylo" (Android) and com.financeva.app://autotrack?import=… (iPhone Shortcut) open
 *    Paste with the text ready; the user still taps Read message.
 * Notifications never show amounts or names, only counts.
 */
import { useEffect } from 'react';
import toast from 'react-hot-toast';
import { Capacitor } from '@capacitor/core';
import { tx } from '../i18n/translations';
import { useStore } from '../store/useStore';
import { ZayloSms, platform } from './native';
import { drainAndroid } from './runner';

let pendingImport: string | null = null;
/** The AutoTrack page takes a waiting import (shared text) when it opens. */
export function takePendingImport() { const t = pendingImport; pendingImport = null; return t; }

function openImport(text: string, navigate: (to: string) => void) {
    if (!text.trim()) return;
    pendingImport = text.slice(0, 2000);
    navigate('/autotrack');
    setTimeout(() => window.dispatchEvent(new CustomEvent('zaylo:autotrack-import', { detail: takePendingImport() ?? '' })), 300);
}

export function useAutoTrackDevice(navigate: (to: string) => void) {
    const signedIn = useStore(s => s.isAuthenticated);
    useEffect(() => {
        if (!signedIn || !Capacitor.isNativePlatform()) return;
        const subs: { remove: () => void }[] = [];
        let alive = true;

        const drain = async () => {
            const results = await drainAndroid().catch(() => []);
            if (!alive || !results.length) return;
            const added = results.filter(r => r.outcome === 'auto_added').length;
            const review = results.filter(r => r.outcome === 'stored' && r.draft?.status === 'needs_review').length;
            if (added || review) {
                toast(`${tx('AutoTrack')}: ${added ? `${added} ${tx('added')}` : ''}${added && review ? ', ' : ''}${review ? `${review} ${tx('to review')}` : ''}`, { id: 'autotrack-drain', duration: 5000 });
                const ws = useStore.getState().activeWorkspaceId;
                if (added && ws) useStore.getState().loadWorkspaceData(ws).catch(() => {});
            }
        };
        const takeShared = async () => {
            try { const { text } = await ZayloSms.getSharedText(); if (text) openImport(text, navigate); } catch { /* older build */ }
        };

        (async () => {
            const { App } = await import('@capacitor/app');
            subs.push(await App.addListener('appUrlOpen', ({ url }) => {
                if (!/^com\.financeva\.app:\/\/autotrack/i.test(url)) return;
                const text = new URL(url.replace(/^com\.financeva\.app:\/\//i, 'https://x/')).searchParams.get('import');
                if (text) openImport(text, navigate); else navigate('/autotrack');
            }));
            if (platform() === 'android' && Capacitor.isPluginAvailable('ZayloSms')) {
                subs.push(await App.addListener('appStateChange', s => { if (s.isActive) { drain(); takeShared(); } }));
                subs.push(await ZayloSms.addListener('smsReceived', drain));
                subs.push(await ZayloSms.addListener('sharedText', takeShared));
                drain(); takeShared();
            }
        })();
        return () => { alive = false; subs.forEach(s => s.remove()); };
    }, [signedIn, navigate]);
}
