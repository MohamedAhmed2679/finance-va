/**
 * Two-step verification with an authenticator app (TOTP), on top of Supabase Auth.
 * The code is checked by the auth server; this file only drives the flow.
 * Server-side enforcement on the data itself is migration v31 (public.mfa_ok).
 */
import { supabase } from '../lib/supabase';

export interface TotpFactor { id: string; name: string; createdAt: string }
export interface Enrolment { factorId: string; qrSvg: string; secret: string }

const offline = () => new Error('Connect to the internet to change two-step verification.');
const friendly = (m: string | undefined, fallback: string) =>
    /invalid.*(totp|code)|code.*invalid|expired/i.test(m || '') ? 'That code is not right, or it has expired. Enter the newest code from your authenticator app.'
        : /too many|rate/i.test(m || '') ? 'Too many attempts. Wait a minute, then try again.'
            : /aal2|insufficient/i.test(m || '') ? 'Confirm a code from your authenticator app first.'
                : fallback;

/** Verified authenticator apps on this account. */
export async function listTotpFactors(): Promise<TotpFactor[]> {
    if (!supabase) return [];
    const { data, error } = await supabase.auth.mfa.listFactors();
    if (error) throw new Error('Two-step verification couldn\'t be checked. Try again.');
    return (data?.totp || []).filter(f => f.status === 'verified').map(f => ({ id: f.id, name: f.friendly_name || 'Authenticator app', createdAt: f.created_at }));
}

/** True when this account has two-step verification on, but this session hasn't passed it yet. */
export async function needsSecondStep(): Promise<boolean> {
    if (!supabase) return false;
    try {
        const { data } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
        return data?.nextLevel === 'aal2' && data?.currentLevel !== 'aal2';
    } catch { return false; }
}

/** Step 1 of setting up: returns the QR code and the secret to type by hand. Nothing is on until confirmEnrolment succeeds. */
export async function startEnrolment(): Promise<Enrolment> {
    if (!supabase || !navigator.onLine) throw offline();
    // A set-up that was started and abandoned leaves an unverified factor behind: clear those first.
    const { data: all } = await supabase.auth.mfa.listFactors();
    for (const f of all?.all || []) if (f.factor_type === 'totp' && f.status !== 'verified') await supabase.auth.mfa.unenroll({ factorId: f.id }).catch(() => {});
    const { data, error } = await supabase.auth.mfa.enroll({ factorType: 'totp', friendlyName: `Authenticator app ${new Date().toISOString().slice(0, 10)}`, issuer: 'Zaylo' });
    if (error || !data) throw new Error(friendly(error?.message, 'Two-step verification couldn\'t be started. Try again.'));
    return { factorId: data.id, qrSvg: data.totp.qr_code, secret: data.totp.secret };
}

/** Checks a 6-digit code against a factor. Used to finish setting up and to pass the second step at sign-in. */
export async function verifyCode(factorId: string, code: string): Promise<void> {
    if (!supabase || !navigator.onLine) throw new Error('Connect to the internet to check the code.');
    const { error } = await supabase.auth.mfa.challengeAndVerify({ factorId, code: code.replace(/\D/g, '') });
    if (error) throw new Error(friendly(error.message, 'The code couldn\'t be checked. Try again.'));
}

export async function cancelEnrolment(factorId: string): Promise<void> {
    await supabase?.auth.mfa.unenroll({ factorId }).catch(() => {});
}

/** Turns two-step verification off. The session must have passed the second step. */
export async function removeFactor(factorId: string): Promise<void> {
    if (!supabase || !navigator.onLine) throw offline();
    const { error } = await supabase.auth.mfa.unenroll({ factorId });
    if (error) throw new Error(friendly(error.message, 'Two-step verification couldn\'t be turned off. Try again.'));
    await supabase.auth.refreshSession().catch(() => {});
}

/** Signs this account out everywhere except this device. */
export async function signOutOtherDevices(): Promise<void> {
    if (!supabase || !navigator.onLine) throw new Error('Connect to the internet to sign out your other devices.');
    const { error } = await supabase.auth.signOut({ scope: 'others' });
    if (error) throw new Error('Your other devices couldn\'t be signed out. Try again.');
}
