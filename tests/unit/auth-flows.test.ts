/** Sign-up, password reset and email-link handling in authProvider (Supabase client mocked). */
import { describe, it, expect, beforeEach, vi } from 'vitest';

let native = false;
vi.mock('@capacitor/core', () => ({ Capacitor: { isNativePlatform: () => native } }));

const calls: Record<string, unknown[]> = {};
const auth = {
    signUp: vi.fn(),
    resetPasswordForEmail: vi.fn(),
    resend: vi.fn(),
    verifyOtp: vi.fn(),
};
vi.mock('../../src/lib/supabase', () => ({ supabase: { auth }, isSupabaseReady: () => true }));

vi.stubGlobal('window', { location: { origin: 'https://zaylo.cc', hostname: 'zaylo.cc', search: '', hash: '', href: 'https://zaylo.cc/' }, history: { replaceState: vi.fn() } });

const ap = await import('../../src/services/authProvider');
const rec = await import('../../src/services/recovery');

beforeEach(() => {
    native = false;
    Object.values(auth).forEach(f => f.mockReset());
    for (const k of Object.keys(calls)) delete calls[k];
    rec.setRecovering(false);
});

describe('sign-up', () => {
    it('an email that already has an account is reported, not "check your inbox"', async () => {
        auth.signUp.mockResolvedValue({ data: { user: { id: 'x', identities: [] }, session: null }, error: null });
        const r = await ap.signUpWithEmail('a@b.co', 'Aa1!aaaa', 'A');
        expect(r.success).toBe(false);
        expect(ap.friendlyAuthError(r.error, '')).toMatch(/already exists/);
    });

    it('a new account with email confirmation on asks for confirmation', async () => {
        auth.signUp.mockResolvedValue({ data: { user: { id: 'x', identities: [{ id: 'i' }] }, session: null }, error: null });
        const r = await ap.signUpWithEmail('a@b.co', 'Aa1!aaaa', 'A');
        expect(r).toMatchObject({ success: true, needsConfirmation: true });
    });

    it('the phone app sends confirmation links back to the app', async () => {
        native = true;
        auth.signUp.mockResolvedValue({ data: { user: { id: 'x', identities: [{ id: 'i' }] }, session: null }, error: null });
        await ap.signUpWithEmail('a@b.co', 'Aa1!aaaa', 'A');
        expect(auth.signUp.mock.calls[0][0].options.emailRedirectTo).toBe(ap.NATIVE_AUTH_REDIRECT);
    });
});

describe('password reset', () => {
    it('web: the link comes back to zaylo.cc marked as recovery', async () => {
        auth.resetPasswordForEmail.mockResolvedValue({ error: null });
        await ap.resetPassword('a@b.co');
        expect(auth.resetPasswordForEmail).toHaveBeenCalledWith('a@b.co', { redirectTo: 'https://zaylo.cc/?type=recovery' });
    });

    it('phone app: the link comes back to the app, where the PKCE secret is', async () => {
        native = true;
        auth.resetPasswordForEmail.mockResolvedValue({ error: null });
        await ap.resetPassword('a@b.co');
        expect(auth.resetPasswordForEmail).toHaveBeenCalledWith('a@b.co', { redirectTo: ap.NATIVE_AUTH_REDIRECT });
    });

    it('a recovery token_hash link turns on the "set a new password" state', async () => {
        auth.verifyOtp.mockResolvedValue({ error: null });
        await ap.verifyEmailLink('hash', 'recovery');
        expect(auth.verifyOtp).toHaveBeenCalledWith({ token_hash: 'hash', type: 'recovery' });
        expect(rec.isRecovering()).toBe(true);
    });

    it('a recovery link that fails leaves the state off', async () => {
        auth.verifyOtp.mockResolvedValue({ error: { message: 'Email link is invalid or has expired' } });
        await expect(ap.verifyEmailLink('hash', 'recovery')).rejects.toBeTruthy();
        expect(rec.isRecovering()).toBe(false);
    });

    it('unknown link types are refused before reaching the server', async () => {
        await expect(ap.verifyEmailLink('hash', 'evil')).rejects.toThrow();
        expect(auth.verifyOtp).not.toHaveBeenCalled();
    });
});

describe('error sentences', () => {
    it.each([
        ['invalid flow state, no valid flow state found', /different browser/],
        ['both auth code and code verifier should be non-empty', /different browser/],
        ['Email link is invalid or has expired', /expired/],
        ['Email not confirmed', /Confirm your email/],
        ['User already registered', /already exists/],
        ['New password should be different from the old password.', /haven't used/],
        ['Failed to fetch', /Can't reach/],
        ['Password should contain at least one character of each: abcdefghijklmnopqrstuvwxyz, ABCDEFGHIJKLMNOPQRSTUVWXYZ, 0123456789', /8 characters/],
        ['Password should be at least 8 characters.', /8 characters/],
    ])('%s', (raw, expected) => {
        expect(ap.friendlyAuthError(raw, 'fallback')).toMatch(expected);
    });
});
