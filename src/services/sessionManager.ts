import { useStore } from '../store/useStore';
import { appLockEnabled } from '../utils/biometric';

let inactivityTimer: ReturnType<typeof setTimeout> | null = null;
let backgroundTime: number | null = null;
const THROTTLE_MS = 1000;
let lastActivityTime = Date.now();
let listeners: Array<{ event: string; handler: EventListener; target: EventTarget }> = [];

export const initSessionManager = () => {
    // Clean up any existing listeners first to prevent duplicates
    cleanupSessionManager();

    const handleActivity = () => {
        const now = Date.now();
        if (now - lastActivityTime > THROTTLE_MS) {
            lastActivityTime = now;
            resetInactivityTimer();
        }
    };

    const handleVisibility = () => {
        if (document.hidden) {
            backgroundTime = Date.now();
        } else {
            if (backgroundTime) {
                const store = useStore.getState();
                const timeoutMs = (store.user?.lockTimeout || 5) * 60 * 1000;
                const timeAway = Date.now() - backgroundTime;
                
                if (appLockEnabled(store.user) && timeAway > timeoutMs) {
                    store.setLocked(true);
                }
                backgroundTime = null;
            }
            resetInactivityTimer();
        }
    };

    // Register window activity listeners
    const windowEvents: Array<[string, EventListener]> = [
        ['mousemove', handleActivity as EventListener],
        ['keydown', handleActivity as EventListener],
        ['touchstart', handleActivity as EventListener],
        ['click', handleActivity as EventListener],
    ];

    windowEvents.forEach(([event, handler]) => {
        window.addEventListener(event, handler, { passive: true });
        listeners.push({ event, handler, target: window });
    });

    // Register visibility change listener
    document.addEventListener('visibilitychange', handleVisibility as EventListener);
    listeners.push({ event: 'visibilitychange', handler: handleVisibility as EventListener, target: document });

    resetInactivityTimer();
};

export const resetInactivityTimer = () => {
    if (inactivityTimer) clearTimeout(inactivityTimer);
    
    const store = useStore.getState();
    const timeoutMin = store.user?.lockTimeout || 5;
    
    // Only set the timer when a PIN or biometric unlock is set up
    if (!appLockEnabled(store.user)) return;

    inactivityTimer = setTimeout(() => {
        const currentStore = useStore.getState();
        if (appLockEnabled(currentStore.user)) {
            currentStore.setLocked(true);
        }
    }, timeoutMin * 60 * 1000);
};

export const cleanupSessionManager = () => {
    if (inactivityTimer) clearTimeout(inactivityTimer);
    inactivityTimer = null;

    // Remove all registered event listeners to prevent memory leaks
    listeners.forEach(({ event, handler, target }) => {
        target.removeEventListener(event, handler);
    });
    listeners = [];
};
