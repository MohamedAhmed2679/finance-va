/**
 * What this device can do for AutoTrack, and the bridge to the Android SMS receiver.
 *
 *  Android app  : a receiver for NEW messages (RECEIVE_SMS) from bank/wallet senders only, after
 *                 the user agrees; optional one-off history scan (READ_SMS) for a chosen date range;
 *                 "Share to Zaylo" from any messaging app.
 *  iPhone app   : no app can read SMS. An iOS Shortcut the user sets up can hand a message to Zaylo
 *                 (always lands in Needs Review); plus Paste.
 *  Web/desktop  : Paste and manual entry only.
 */
import { Capacitor, registerPlugin, type PluginListenerHandle } from '@capacitor/core';

export type Platform = 'android' | 'ios' | 'web' | 'desktop';
export type DeviceState = 'unsupported' | 'off' | 'enabled' | 'paused' | 'denied';
export interface NativeStatus { supported: boolean; permission: 'granted' | 'denied' | 'prompt'; enabled: boolean; paused: boolean; pending: number; lastReceivedAt?: string | null }
export interface NativeMessage { id: string; sender: string; body: string; receivedAt: string }

interface ZayloSmsPlugin {
    getStatus(): Promise<NativeStatus>;
    requestPermission(): Promise<{ permission: NativeStatus['permission'] }>;
    configure(o: { enabled: boolean; paused: boolean; senders: string[] }): Promise<void>;
    drain(): Promise<{ messages: NativeMessage[] }>;
    acknowledge(o: { ids: string[] }): Promise<void>;
    requestHistoryPermission(): Promise<{ permission: NativeStatus['permission'] }>;
    scanHistory(o: { from: number; to: number; senders: string[] }): Promise<{ messages: NativeMessage[] }>;
    getSharedText(): Promise<{ text: string | null }>;
    openAppSettings(): Promise<void>;
    addListener(event: 'smsReceived' | 'sharedText', cb: () => void): Promise<PluginListenerHandle>;
}
export const ZayloSms = registerPlugin<ZayloSmsPlugin>('ZayloSms');

export function platform(): Platform {
    const p = Capacitor.getPlatform();
    if (p === 'android' || p === 'ios') return p;
    return typeof navigator !== 'undefined' && /Electron/i.test(navigator.userAgent) ? 'desktop' : 'web';
}

/** True only when the installed Android app actually contains the receiver (older builds don't). */
export async function nativeStatus(): Promise<NativeStatus | null> {
    if (platform() !== 'android' || !Capacitor.isPluginAvailable('ZayloSms')) return null;
    try { return await ZayloSms.getStatus(); } catch { return null; }
}

export function deviceState(s: NativeStatus | null): DeviceState {
    if (!s || !s.supported) return 'unsupported';
    if (s.permission === 'denied' && s.enabled) return 'denied';
    if (!s.enabled) return 'off';
    if (s.permission !== 'granted') return 'denied';
    return s.paused ? 'paused' : 'enabled';
}
