import { useEffect, useState } from 'react';
import { motion, useAnimationControls } from 'framer-motion';
import { Delete, Fingerprint, ScanFace } from 'lucide-react';
import { useStore } from '../store/useStore';
import { hashPin, pinMatches } from '../utils/pin';
import { hasBiometric, verifyBiometric, getBiometricSupport, type BiometricSupport } from '../utils/biometric';
import { Seal } from './brand/Brand';

/** App lock. Unlocks with a correct PIN or a real device biometric check — nothing else. */
export default function LockScreen() {
    const { user, setLocked, updateUser, logout } = useStore();
    const [entry, setEntry] = useState('');
    const [attempts, setAttempts] = useState(0);
    const shake = useAnimationControls();
    const salt = user?.id || 'fv';
    const bio = Boolean(user?.biometricEnabled && hasBiometric(user?.id));
    const hasPin = Boolean(user?.pin);
    const [support, setSupport] = useState<BiometricSupport | null>(null);
    const [bioMsg, setBioMsg] = useState('');

    async function unlockWithBiometric() {
        if (!user) return;
        setBioMsg('');
        if (await verifyBiometric(user.id)) { setLocked(false); return; }
        setBioMsg(hasPin ? 'Not recognised. Try again or use your PIN.' : 'Not recognised. Try again.');
    }

    useEffect(() => {
        if (!bio) return;
        getBiometricSupport().then(setSupport);
        // Prompt straight away; browsers may need a tap first, which the button covers.
        const t = setTimeout(() => { unlockWithBiometric(); }, 350);
        return () => clearTimeout(t);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    async function check(pin: string) {
        if (await pinMatches(pin, user?.pin, salt)) {
            if (user?.pin && !user.pin.startsWith('sha256:')) updateUser({ pin: await hashPin(pin, salt) });
            setLocked(false);
            return;
        }
        setAttempts(a => a + 1);
        await shake.start({ x: [0, -10, 10, -6, 6, 0], transition: { duration: 0.36 } });
        setEntry('');
    }

    function press(d: string) {
        if (entry.length >= 4) return;
        const next = entry + d;
        setEntry(next);
        if (next.length === 4) check(next);
    }

    useEffect(() => {
        if (!hasPin) return;
        const onKey = (e: KeyboardEvent) => {
            if (/^\d$/.test(e.key)) press(e.key);
            else if (e.key === 'Backspace') setEntry(s => s.slice(0, -1));
        };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    });

    return (
        <div className="lock" role="dialog" aria-label="Finance VA is locked">
            <Seal size={56} />
            <div style={{ textAlign: 'center' }}>
                <h2 style={{ fontSize: 26 }}>{hasPin ? 'Enter your PIN' : 'Finance VA is locked'}</h2>
                <p style={{ color: 'var(--ink-3)', marginTop: 6, fontSize: 14 }}>
                    {bioMsg || (attempts >= 3 ? 'Forgot it? Sign out and sign back in to reset the lock.' : 'Finance VA locked after a period of inactivity.')}
                </p>
            </div>
            {bio && (
                <button className="btn btn-secondary" onClick={unlockWithBiometric} style={{ gap: 10 }}>
                    {support?.kind === 'face' ? <ScanFace size={20} /> : <Fingerprint size={20} />}
                    Unlock with {support?.label ?? 'biometrics'}
                </button>
            )}
            {hasPin && <>
            <motion.div animate={shake} style={{ display: 'flex', gap: 14 }} aria-live="polite" aria-label={`${entry.length} of 4 digits entered`}>
                {[0, 1, 2, 3].map(i => (
                    <motion.span key={i} animate={{ scale: entry.length > i ? 1 : 0.7, backgroundColor: entry.length > i ? 'var(--note)' : 'var(--surface-3)' }}
                        style={{ width: 14, height: 14, borderRadius: 7, display: 'block' }} />
                ))}
            </motion.div>
            <div className="keypad" style={{ width: '100%', maxWidth: 280 }}>
                {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map(n => <button key={n} className="keypad-btn" onClick={() => press(n)}>{n}</button>)}
                <button className="keypad-btn" style={{ fontSize: 13, background: 'none', border: 'none', color: 'var(--ink-3)' }} onClick={() => { setLocked(false); logout(); }}>Sign out</button>
                <button className="keypad-btn" onClick={() => press('0')}>0</button>
                <button className="keypad-btn" style={{ background: 'none', border: 'none', display: 'grid', placeItems: 'center' }} aria-label="Delete digit" onClick={() => setEntry(s => s.slice(0, -1))}><Delete size={22} /></button>
            </div>
            </>}
            {!hasPin && <button className="btn btn-ghost btn-sm" onClick={() => { setLocked(false); logout(); }}>Sign out</button>}
        </div>
    );
}
