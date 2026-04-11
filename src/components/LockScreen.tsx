import { useState, useEffect } from 'react';
import { useStore } from '../store/useStore';
import { Lock, Fingerprint, RefreshCw } from 'lucide-react';

export default function LockScreen() {
    const { user, setLocked } = useStore();
    const [pinEntry, setPinEntry] = useState('');
    const [error, setError] = useState(false);
    const [biometricScanning, setBiometricScanning] = useState(false);

    useEffect(() => {
        // Mock biometric trigger
        if (user?.biometricEnabled) {
            triggerBiometric();
        }
    }, [user?.biometricEnabled]);

    const triggerBiometric = () => {
        setBiometricScanning(true);
        // Simulate a biometric prompt — always succeeds in web context.
        // In a native app, this would call the platform's biometric API.
        setTimeout(() => {
            setBiometricScanning(false);
            setLocked(false);
        }, 1200);
    };

    const handlePinInput = (num: string) => {
        if (pinEntry.length < 4) {
            const newPin = pinEntry + num;
            setPinEntry(newPin);
            if (newPin.length === 4) {
                verifyPin(newPin);
            }
        }
    };

    const handleBackspace = () => {
        setPinEntry(pinEntry.slice(0, -1));
        setError(false);
    };

    const verifyPin = (pin: string) => {
        if (pin === user?.pin) {
            setLocked(false);
        } else {
            setError(true);
            setTimeout(() => {
                setPinEntry('');
                setError(false);
            }, 500);
        }
    };

    return (
        <div style={{
            position: 'fixed', inset: 0, zIndex: 9999, background: 'var(--bg-base)',
            display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: 24
        }}>
            <div style={{ marginBottom: 40, display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                <div style={{ width: 64, height: 64, borderRadius: 32, background: 'var(--accent-muted)', color: 'var(--accent)', display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: 16 }}>
                    <Lock size={32} />
                </div>
                <h2 style={{ fontSize: 24, fontWeight: 700, marginBottom: 8 }}>Finance VA Locked</h2>
                <div style={{ color: 'var(--text-secondary)' }}>Enter your PIN to continue</div>
            </div>

            <div style={{ display: 'flex', gap: 16, marginBottom: 40 }}>
                {[1, 2, 3, 4].map(i => (
                    <div key={i} style={{
                        width: 16, height: 16, borderRadius: 8,
                        background: pinEntry.length >= i ? 'var(--accent)' : 'var(--border-default)',
                        transition: 'background 200ms ease',
                        animation: error ? 'shake 0.4s ease' : 'none'
                    }} />
                ))}
            </div>

            <style>{`
                @keyframes shake {
                    0%, 100% { transform: translateX(0); }
                    25% { transform: translateX(-5px); }
                    75% { transform: translateX(5px); }
                }
            `}</style>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 24, maxWidth: 280, width: '100%' }}>
                {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map(num => (
                    <button key={num} onClick={() => handlePinInput(num)} style={{
                        height: 64, borderRadius: 32, fontSize: 24, fontWeight: 500, background: 'var(--bg-surface)', border: '1px solid var(--border-default)',
                        display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer'
                    }}>{num}</button>
                ))}
                
                {user?.biometricEnabled ? (
                    <button onClick={triggerBiometric} style={{
                        height: 64, borderRadius: 32, background: 'transparent', border: 'none', color: 'var(--accent)',
                        display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer'
                    }}>
                        {biometricScanning ? <RefreshCw size={28} className="animate-spin" /> : <Fingerprint size={32} />}
                    </button>
                ) : <div />}

                <button onClick={() => handlePinInput('0')} style={{
                    height: 64, borderRadius: 32, fontSize: 24, fontWeight: 500, background: 'var(--bg-surface)', border: '1px solid var(--border-default)',
                    display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer'
                }}>0</button>

                <button onClick={handleBackspace} style={{
                    height: 64, borderRadius: 32, fontSize: 16, fontWeight: 500, background: 'transparent', border: 'none', color: 'var(--text-secondary)',
                    display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer'
                }}>Delete</button>
            </div>
        </div>
    );
}
