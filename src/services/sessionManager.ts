import { useStore } from '../store/useStore';

let inactivityTimer: ReturnType<typeof setTimeout> | null = null;
let backgroundTime: number | null = null;
const THROTTLE_MS = 1000;
let lastActivityTime = Date.now();

export const initSessionManager = () => {
    // Reset timer on user activity
    const handleActivity = () => {
        const now = Date.now();
        if (now - lastActivityTime > THROTTLE_MS) {
            lastActivityTime = now;
            resetInactivityTimer();
        }
    };

    // Listen to standard interaction events
    window.addEventListener('mousemove', handleActivity, { passive: true });
    window.addEventListener('keydown', handleActivity, { passive: true });
    window.addEventListener('touchstart', handleActivity, { passive: true });
    window.addEventListener('click', handleActivity, { passive: true });

    // Handle visibility changes (tab backgrounded)
    document.addEventListener('visibilitychange', () => {
        if (document.hidden) {
            backgroundTime = Date.now();
        } else {
            if (backgroundTime) {
                const store = useStore.getState();
                const timeoutMs = (store.user?.lockTimeout || 5) * 60 * 1000;
                const timeAway = Date.now() - backgroundTime;
                
                if (store.user?.biometricEnabled && store.user?.pin && timeAway > timeoutMs) {
                    store.setLocked(true);
                }
                backgroundTime = null;
            }
            resetInactivityTimer();
        }
    });

    resetInactivityTimer();
};

export const resetInactivityTimer = () => {
    if (inactivityTimer) clearTimeout(inactivityTimer);
    
    const store = useStore.getState();
    const timeoutMsg = store.user?.lockTimeout || 5;
    
    // Only set timer if biometric/PIN is enabled and a PIN exists
    if (!store.user?.biometricEnabled || !store.user?.pin) return;

    inactivityTimer = setTimeout(() => {
        const currentStore = useStore.getState();
        if (currentStore.user?.biometricEnabled && currentStore.user?.pin) {
            currentStore.setLocked(true);
        }
    }, timeoutMsg * 60 * 1000);
};

export const cleanupSessionManager = () => {
    if (inactivityTimer) clearTimeout(inactivityTimer);
};
