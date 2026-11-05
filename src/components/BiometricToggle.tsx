import { tx } from '../i18n/translations';
import { useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { Fingerprint, ScanFace } from 'lucide-react';
import { useStore } from '../store/useStore';
import { enrollBiometric, getBiometricSupport, hasBiometric, removeBiometric, type BiometricSupport } from '../utils/biometric';

/** On/off row for biometric unlock. Turning it on shows the real device prompt. */
export default function BiometricToggle({ compact = false }: { compact?: boolean }) {
    const { user, updateUser } = useStore();
    const [support, setSupport] = useState<BiometricSupport | null>(null);
    const [busy, setBusy] = useState(false);
    const on = Boolean(user?.biometricEnabled && hasBiometric(user?.id));

    useEffect(() => { getBiometricSupport().then(setSupport); }, []);

    async function toggle() {
        if (!user || busy) return;
        if (on) {
            removeBiometric(user.id);
            updateUser({ biometricEnabled: false });
            toast.success(tx('Biometric unlock turned off on this device'));
            return;
        }
        setBusy(true);
        try {
            await enrollBiometric(user);
            updateUser({ biometricEnabled: true });
            toast.success(`${support?.label ?? 'Biometric'} unlock is on for this device`);
        } catch (e) {
            toast.error(e instanceof Error ? e.message : 'Couldn\'t turn it on');
        } finally { setBusy(false); }
    }

    const Icon = support?.kind === 'face' ? ScanFace : Fingerprint;
    const unavailable = support && !support.available;
    const title = support?.label ? `Unlock with ${support.label}` : 'Biometric unlock';
    const desc = unavailable ? support!.reason : busy ? 'Follow the prompt on your device…' : 'Locks after inactivity; your face or fingerprint opens it.';

    return (
        <div className="bio-row" style={{ padding: compact ? 14 : 16, opacity: unavailable ? 0.7 : 1 }}>
            <span className="bio-icon"><Icon size={22} /></span>
            <span style={{ flex: 1, minWidth: 0 }}>
                <span style={{ display: 'block', fontWeight: 600, fontSize: 15 }}>{title}</span>
                <span style={{ display: 'block', fontSize: 13, color: 'var(--ink-3)' }}>{desc}</span>
            </span>
            <button type="button" role="switch" aria-checked={on} aria-label={title} className="switch" data-on={on}
                disabled={!support || !!unavailable || busy} onClick={toggle}>
                <span />
            </button>
        </div>
    );
}
