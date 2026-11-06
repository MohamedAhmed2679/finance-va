/**
 * zaylo.cc/app-signin — opened by the phone app in the system browser.
 * Shows Google's button for zaylo.cc and sends the ID token back to the app. It never signs in on the web
 * and only ever returns to the Zaylo app's own link.
 */
import { useEffect, useRef, useState } from 'react';
import { renderGoogleButton } from '../services/googleSignIn';
import { NATIVE_AUTH_REDIRECT } from '../services/authProvider';

export default function AppSignInPage() {
    const q = new URLSearchParams(window.location.search);
    const nonce = q.get('nonce') || '';
    const state = q.get('state') || '';
    const valid = /^[0-9a-f]{64}$/.test(nonce) && /^[\w-]{16,64}$/.test(state);
    const ar = (navigator.language || '').startsWith('ar');
    const box = useRef<HTMLDivElement>(null);
    const [phase, setPhase] = useState<'ready' | 'returning' | 'error'>(valid ? 'ready' : 'error');
    const [back, setBack] = useState('');

    useEffect(() => {
        if (!valid || !box.current) return;
        renderGoogleButton(box.current, {
            width: Math.min(360, window.innerWidth - 48), locale: ar ? 'ar' : 'en', hashedNonce: nonce,
            onCredential: token => {
                if (!token) return;
                const url = `${NATIVE_AUTH_REDIRECT}?id_token=${encodeURIComponent(token)}&state=${encodeURIComponent(state)}`;
                setBack(url);
                setPhase('returning');
                window.location.href = url;
            },
        }).catch(() => setPhase('error'));
    }, [valid, nonce, state, ar]);

    const t = (en: string, a: string) => (ar ? a : en);
    return (
        <main className="app-signin" dir={ar ? 'rtl' : 'ltr'}>
            <img src="/icon-192.png" alt="" width={56} height={56} />
            <h1>{t('Sign in to the Zaylo app', 'تسجيل الدخول إلى تطبيق Zaylo')}</h1>
            {phase === 'ready' && <>
                <p>{t('Choose your Google account. You\'ll go straight back to the app.', 'اختر حساب Google. ستعود إلى التطبيق مباشرة.')}</p>
                <div ref={box} className="app-signin-btn" />
            </>}
            {phase === 'returning' && <>
                <p>{t('Signed in with Google. Returning to the Zaylo app…', 'تم تسجيل الدخول باستخدام Google. جارٍ العودة إلى تطبيق Zaylo…')}</p>
                <a className="btn btn-primary" href={back}>{t('Open the Zaylo app', 'افتح تطبيق Zaylo')}</a>
            </>}
            {phase === 'error' && <p>{t('This sign-in link isn\'t valid any more. Go back to the Zaylo app and tap Continue with Google again.', 'رابط تسجيل الدخول هذا لم يعد صالحًا. ارجع إلى تطبيق Zaylo واضغط "المتابعة باستخدام Google" مرة أخرى.')}</p>}
        </main>
    );
}
