// src/services/authService.ts
// Microsoft auth is handled entirely by Supabase's Azure provider.
// No client-side MSAL configuration needed.

// --- GOOGLE OAUTH ---
export const GOOGLE_CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID || '';

// --- APPLE SIGN-IN / CLOUDKIT ---
export const APPLE_CONFIG = {
    clientId: import.meta.env.VITE_APPLE_CLIENT_ID || 'com.financeva.app.signin',
    scope: 'name email',
    redirectURI: `${window.location.origin}/apple/callback`,
    state: 'initial',
    usePopup: true,
};

export function initCloudKit() {
    if (typeof (window as any).CloudKit !== 'undefined') {
        (window as any).CloudKit.configure({
            containers: [{
                containerIdentifier: import.meta.env.VITE_CLOUDKIT_CONTAINER || 'iCloud.com.financeva.app',
                apiTokenAuth: {
                    apiToken: import.meta.env.VITE_CLOUDKIT_API_TOKEN || '',
                    persist: true,
                    signInButton: { theme: 'black', shape: 'pill' },
                },
                environment: 'development',
            }],
        });
    }
}
