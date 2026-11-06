/**
 * Saved sign-in on this device.
 *
 *  - Keep me signed in (default on): the session survives closing the app. Off = it lasts only until
 *    the app or browser is closed, and this account's data is cleared from the device then.
 *  - Saved accounts: name, email and how the person signs in, shown on the sign-in screen so they can
 *    tap to sign back in. Never a password or token.
 *  - Save password: the browser / Android password manager offers to save it (standard autofill;
 *    Chrome and Edge also through the Credential Management API).
 *  - Fingerprint / Face ID sign-in (phone apps): the email and password are kept in the phone's
 *    secure Keystore / Keychain and released only after the phone's own biometric check.
 */
import { Capacitor } from '@capacitor/core';

export type SignInMethod = 'email' | 'google' | 'azure' | 'apple' | 'phone';
export interface SavedAccount { email: string; name: string; method: SignInMethod; lastUsedAt: string; biometric?: boolean }

const ACCOUNTS = 'zaylo_saved_accounts_v1';
export const KEEP_KEY = 'zaylo_keep_signed_in';
const server = (email: string) => `zaylo.cc:${email.trim().toLowerCase()}`;

const read = (): SavedAccount[] => { try { return JSON.parse(localStorage.getItem(ACCOUNTS) || '[]'); } catch { return []; } };
const write = (l: SavedAccount[]) => { try { if (l.length) localStorage.setItem(ACCOUNTS, JSON.stringify(l.slice(0, 5))); else localStorage.removeItem(ACCOUNTS); } catch { /* storage blocked */ } };

export const savedAccounts = () => read().sort((a, b) => b.lastUsedAt.localeCompare(a.lastUsedAt));

export function rememberAccount(a: Omit<SavedAccount, 'lastUsedAt'>) {
    if (!a.email || !keepSignedIn()) return;
    const key = a.email.toLowerCase();
    const old = read().find(x => x.email.toLowerCase() === key);
    write([{ ...old, ...a, biometric: a.biometric ?? old?.biometric, lastUsedAt: new Date().toISOString() }, ...read().filter(x => x.email.toLowerCase() !== key)]);
}

export async function forgetAccount(email: string) {
    write(read().filter(x => x.email.toLowerCase() !== email.toLowerCase()));
    await removeBiometricSignIn(email);
}

export function keepSignedIn(): boolean { try { return localStorage.getItem(KEEP_KEY) !== '0'; } catch { return true; } }
export function setKeepSignedIn(v: boolean) { try { localStorage.setItem(KEEP_KEY, v ? '1' : '0'); } catch { /* ignore */ } }

// ─── password managers

/** Asks the browser to save the password (Chrome/Edge show their own prompt; elsewhere autofill handles it). */
export async function offerToSavePassword(email: string, password: string, name: string) {
    try {
        const W = window as unknown as { PasswordCredential?: new (d: { id: string; password: string; name?: string }) => Credential };
        if (!W.PasswordCredential || !navigator.credentials?.store) return;
        await navigator.credentials.store(new W.PasswordCredential({ id: email, password, name }));
    } catch { /* the person said no, or the browser doesn't support it */ }
}

// ─── fingerprint / Face ID sign-in (phone apps)

export const biometricSignInPossible = () => Capacitor.isNativePlatform();

export async function biometricAvailable(): Promise<{ ok: boolean; label: string }> {
    if (!biometricSignInPossible()) return { ok: false, label: '' };
    try {
        const { NativeBiometric, BiometryType } = await import('@capgo/capacitor-native-biometric');
        const r = await NativeBiometric.isAvailable({ useFallback: false });
        const label = r.biometryType === BiometryType.FACE_ID ? 'Face ID' : r.biometryType === BiometryType.TOUCH_ID ? 'Touch ID' : 'fingerprint';
        return { ok: r.isAvailable, label };
    } catch { return { ok: false, label: '' }; }
}

/** Saves the sign-in in the secure Keystore / Keychain after the person confirms with biometrics. */
export async function enableBiometricSignIn(email: string, password: string): Promise<void> {
    const { NativeBiometric } = await import('@capgo/capacitor-native-biometric');
    await NativeBiometric.verifyIdentity({ reason: 'Sign in to Zaylo with biometrics next time', title: 'Zaylo', subtitle: 'Confirm it\'s you' });
    await NativeBiometric.setCredentials({ username: email.trim().toLowerCase(), password, server: server(email) });
    const a = read().find(x => x.email.toLowerCase() === email.toLowerCase());
    if (a) write(read().map(x => (x === a ? { ...a, biometric: true } : x)));
}

/** After the biometric check, the saved email and password (or null if cancelled / not set up). */
export async function biometricCredentials(email: string): Promise<{ email: string; password: string } | null> {
    const { NativeBiometric } = await import('@capgo/capacitor-native-biometric');
    try {
        await NativeBiometric.verifyIdentity({ reason: 'Sign in to Zaylo', title: 'Zaylo', subtitle: email });
        const c = await NativeBiometric.getCredentials({ server: server(email) });
        return c?.password ? { email: c.username || email, password: c.password } : null;
    } catch { return null; }
}

export async function removeBiometricSignIn(email: string) {
    write(read().map(x => (x.email.toLowerCase() === email.toLowerCase() ? { ...x, biometric: false } : x)));
    if (!biometricSignInPossible()) return;
    try { const { NativeBiometric } = await import('@capgo/capacitor-native-biometric'); await NativeBiometric.deleteCredentials({ server: server(email) }); } catch { /* nothing saved */ }
}
