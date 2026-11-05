import type { CapacitorConfig } from '@capacitor/cli';

/**
 * The test apps load the live deployment, so every push to main is what testers see
 * (same Supabase env, same /api functions). Override with CAP_SERVER_URL for staging,
 * or set CAP_BUNDLED=true to ship the local dist/ build instead.
 */
const serverUrl = process.env.CAP_SERVER_URL || 'https://finance-va.vercel.app';
const bundled = process.env.CAP_BUNDLED === 'true';

const config: CapacitorConfig = {
    appId: 'com.financeva.app',
    appName: 'Zaylo',
    webDir: 'dist',
    backgroundColor: '#EEF1EC',
    server: bundled ? undefined : { url: serverUrl, cleartext: false },
    android: { allowMixedContent: false },
    ios: { contentInset: 'never', scheme: 'Finance VA' },
};

export default config;
