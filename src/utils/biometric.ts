/**
 * Real device biometrics for the app lock.
 *
 * - Android / iOS apps (Capacitor): the system Face ID / Touch ID / fingerprint prompt
 *   via @capgo/capacitor-native-biometric.
 * - Browsers and desktop: the device's built-in authenticator (Face ID, Touch ID,
 *   Windows Hello, Android fingerprint) through WebAuthn. A credential is created
 *   once on this device; unlocking asks the device to verify the user with it.
 *
 * Enrolment is per device, so turning it on here doesn't affect other devices.
 */
import { Capacitor } from '@capacitor/core';

export type BiometricKind = 'face' | 'fingerprint' | 'device';
export interface BiometricSupport { available: boolean; kind: BiometricKind; label: string; reason?: string }

const KEY = (userId: string) => `fva_biometric_${userId}`;
const isNative = () => Capacitor.isNativePlatform();

function read(userId: string): { type: 'native' | 'webauthn'; credentialId?: string } | null {
    try { const raw = localStorage.getItem(KEY(userId)); return raw ? JSON.parse(raw) : null; } catch { return null; }
}
function write(userId: string, value: object | null) {
    try { if (value) localStorage.setItem(KEY(userId), JSON.stringify(value)); else localStorage.removeItem(KEY(userId)); } catch { /* storage unavailable */ }
}

const b64url = {
    encode(buf: ArrayBuffer) {
        return btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    },
    decode(s: string) {
        const bin = atob(s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4));
        return Uint8Array.from(bin, c => c.charCodeAt(0));
    },
};
const randomBytes = (n = 32) => crypto.getRandomValues(new Uint8Array(n));

function webLabel(): { kind: BiometricKind; label: string } {
    const ua = navigator.userAgent;
    if (/iPhone|iPad/.test(ua)) return { kind: 'face', label: 'Face ID or Touch ID' };
    if (/Macintosh/.test(ua)) return { kind: 'fingerprint', label: 'Touch ID' };
    if (/Windows/.test(ua)) return { kind: 'device', label: 'Windows Hello' };
    if (/Android/.test(ua)) return { kind: 'fingerprint', label: 'fingerprint or face unlock' };
    return { kind: 'device', label: 'your device\'s fingerprint or face unlock' };
}

/** What this device can do. Never throws. */
export async function getBiometricSupport(): Promise<BiometricSupport> {
    try {
        if (isNative()) {
            const { NativeBiometric, BiometryType } = await import('@capgo/capacitor-native-biometric');
            const r = await NativeBiometric.isAvailable({ useFallback: false });
            const face = r.biometryType === BiometryType.FACE_ID || r.biometryType === BiometryType.FACE_AUTHENTICATION;
            const label = r.biometryType === BiometryType.FACE_ID ? 'Face ID' : r.biometryType === BiometryType.TOUCH_ID ? 'Touch ID' : face ? 'face unlock' : 'fingerprint';
            return r.isAvailable
                ? { available: true, kind: face ? 'face' : 'fingerprint', label }
                : { available: false, kind: 'device', label, reason: 'Set up Face ID or a fingerprint in your phone\'s settings first.' };
        }
        const { kind, label } = webLabel();
        if (!window.PublicKeyCredential || !window.isSecureContext) {
            return { available: false, kind, label, reason: 'This browser can\'t use Face ID or fingerprint. Use a PIN instead.' };
        }
        const ok = await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable();
        return ok ? { available: true, kind, label } : { available: false, kind, label, reason: 'This device has no Face ID, Touch ID, fingerprint or Windows Hello set up. Use a PIN instead.' };
    } catch {
        return { available: false, kind: 'device', label: 'biometrics', reason: 'Biometric unlock isn\'t available here. Use a PIN instead.' };
    }
}

export const hasBiometric = (userId?: string) => Boolean(userId && read(userId));

/** Turns biometric unlock on for this device. Shows the system prompt. Throws a readable error. */
export async function enrollBiometric(user: { id: string; name?: string; email?: string }): Promise<void> {
    const support = await getBiometricSupport();
    if (!support.available) throw new Error(support.reason || 'Not available on this device.');

    if (isNative()) {
        const { NativeBiometric } = await import('@capgo/capacitor-native-biometric');
        try {
            await NativeBiometric.verifyIdentity({ reason: 'Turn on biometric unlock for Finance VA', title: 'Finance VA', subtitle: 'Confirm it\'s you' });
        } catch { throw new Error('Not turned on: verification was cancelled or failed.'); }
        write(user.id, { type: 'native' });
        return;
    }

    try {
        const cred = await navigator.credentials.create({
            publicKey: {
                challenge: randomBytes(),
                rp: { name: 'Finance VA', id: window.location.hostname },
                user: { id: new TextEncoder().encode(user.id).slice(0, 64), name: user.email || user.name || 'Finance VA user', displayName: user.name || user.email || 'Finance VA user' },
                pubKeyCredParams: [{ type: 'public-key', alg: -7 }, { type: 'public-key', alg: -257 }],
                authenticatorSelection: { authenticatorAttachment: 'platform', userVerification: 'required', residentKey: 'discouraged' },
                timeout: 60_000,
                attestation: 'none',
            },
        }) as PublicKeyCredential | null;
        if (!cred) throw new Error('cancelled');
        write(user.id, { type: 'webauthn', credentialId: b64url.encode(cred.rawId) });
    } catch (e) {
        const name = e instanceof DOMException ? e.name : '';
        if (name === 'NotAllowedError' || (e instanceof Error && e.message === 'cancelled')) throw new Error('Not turned on: the prompt was cancelled.');
        if (name === 'InvalidStateError') throw new Error('This device is already set up. Try turning it off and on again.');
        throw new Error('Your device couldn\'t set up biometric unlock. Use a PIN instead.');
    }
}

/** Asks the device to verify the user. Resolves true only on success. */
export async function verifyBiometric(userId: string): Promise<boolean> {
    const saved = read(userId);
    if (!saved) return false;
    try {
        if (saved.type === 'native') {
            if (!isNative()) return false;
            const { NativeBiometric } = await import('@capgo/capacitor-native-biometric');
            await NativeBiometric.verifyIdentity({ reason: 'Unlock Finance VA', title: 'Unlock Finance VA' });
            return true;
        }
        if (!saved.credentialId || !window.PublicKeyCredential) return false;
        const res = await navigator.credentials.get({
            publicKey: {
                challenge: randomBytes(),
                rpId: window.location.hostname,
                allowCredentials: [{ type: 'public-key', id: b64url.decode(saved.credentialId) }],
                userVerification: 'required',
                timeout: 60_000,
            },
        }) as PublicKeyCredential | null;
        const flags = res ? new Uint8Array((res.response as AuthenticatorAssertionResponse).authenticatorData)[32] : 0;
        return Boolean(res && (flags & 0x04)); // UV flag: the device verified the user
    } catch {
        return false;
    }
}

export function removeBiometric(userId?: string) { if (userId) write(userId, null); }

/** Auto-lock applies when the user has a PIN or biometric unlock on this device. */
export const appLockEnabled = (user?: { id: string; pin?: string; biometricEnabled?: boolean } | null) =>
    Boolean(user && (user.pin || (user.biometricEnabled && hasBiometric(user.id))));
