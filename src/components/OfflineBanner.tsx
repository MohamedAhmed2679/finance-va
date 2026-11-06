import { useEffect, useState } from 'react';
import { WifiOff } from 'lucide-react';
import { tx } from '../i18n/translations';
import { useStore } from '../store/useStore';

/** Offline: say so, keep working from what's on the device, and catch up as soon as the connection is back. */
export default function OfflineBanner() {
    const [offline, setOffline] = useState(() => typeof navigator !== 'undefined' && navigator.onLine === false);
    useEffect(() => {
        const down = () => { setOffline(true); useStore.setState({ syncStatus: 'offline' }); };
        const up = () => {
            setOffline(false);
            const { activeWorkspaceId, loadWorkspaceData } = useStore.getState();
            if (activeWorkspaceId) loadWorkspaceData(activeWorkspaceId).catch(() => {});
        };
        if (navigator.onLine === false) useStore.setState({ syncStatus: 'offline' });
        window.addEventListener('offline', down);
        window.addEventListener('online', up);
        return () => { window.removeEventListener('offline', down); window.removeEventListener('online', up); };
    }, []);
    if (!offline) return null;
    return <div className="offline-banner" role="status"><WifiOff size={14} aria-hidden /> {tx('Offline — showing what\'s saved on this device')}</div>;
}
