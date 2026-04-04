import { PublicClientApplication } from '@azure/msal-browser';

// --- GOOGLE OAUTH ---
// For Google, we use @react-oauth/google in the provider, but here are the constants.
export const GOOGLE_CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID || 'mock-google-client-id';

// --- MICROSOFT (MSAL) OAUTH ---
export const MSAL_CONFIG = {
    auth: {
        clientId: import.meta.env.VITE_MSAL_CLIENT_ID || 'mock-msal-client-id',
        authority: 'https://login.microsoftonline.com/common',
        redirectUri: window.location.origin
    },
    cache: {
        cacheLocation: 'sessionStorage',
        storeAuthStateInCookie: false,
    }
};

export const msalInstance = new PublicClientApplication(MSAL_CONFIG);

export const msLoginRequest = {
    scopes: ['User.Read', 'Files.ReadWrite.AppFolder']
};

export async function getMsAccessToken() {
    const account = msalInstance.getAllAccounts()[0];
    if (!account) throw new Error('No active account! Verify a user has been signed in and setActiveAccount has been called.');

    const response = await msalInstance.acquireTokenSilent({
        ...msLoginRequest,
        account: account
    });
    return response.accessToken;
}

// --- APPLE SIGN-IN / CLOUDKIT ---
export const APPLE_CONFIG = {
    clientId: import.meta.env.VITE_APPLE_CLIENT_ID || 'com.financeva.app.signin',
    scope: 'name email',
    redirectURI: `${window.location.origin}/apple/callback`,
    state: 'initial',
    usePopup: true // or false depending on mobile vs web
};

export function initCloudKit() {
    if (typeof (window as any).CloudKit !== 'undefined') {
        (window as any).CloudKit.configure({
            containers: [{
                containerIdentifier: import.meta.env.VITE_CLOUDKIT_CONTAINER || 'iCloud.com.financeva.app',
                apiTokenAuth: {
                    apiToken: import.meta.env.VITE_CLOUDKIT_API_TOKEN || 'mock-cloudkit-token',
                    persist: true,
                    signInButton: { theme: 'black', shape: 'pill' }
                },
                environment: 'development'
            }]
        });
    }
}
