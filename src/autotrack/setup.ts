/** AutoTrack setup state and the accounts made from the banks and wallets the person picks. */
import { knownSenders } from './senders';
import { loadAccounts, addAccount } from './service';

const SETUP_KEY = 'zaylo_autotrack_setup_v1';
export function isSetUp(userId?: string): boolean {
    try { return Boolean(userId && localStorage.getItem(`${SETUP_KEY}:${userId}`)); } catch { return false; }
}
export function markSetUp(userId?: string) { try { if (userId) localStorage.setItem(`${SETUP_KEY}:${userId}`, new Date().toISOString()); } catch { /* storage blocked */ } }

const ACCOUNT_KIND = { bank: 'bank', wallet: 'wallet', card: 'card' } as const;

/** Turns the picked providers into "my accounts" (so transfers between them aren't counted twice). */
export async function createAccountsFor(ids: string[]) {
    const have = await loadAccounts().catch(() => []);
    const known = knownSenders();
    let made = 0;
    for (const id of ids) {
        const k = known.find(x => x.id === id);
        if (!k || !(k.kind in ACCOUNT_KIND)) continue;                // InstaPay, Fawry… are services, not accounts
        if (have.some(a => a.senderId === id)) continue;
        await addAccount({ label: k.name, kind: ACCOUNT_KIND[k.kind as keyof typeof ACCOUNT_KIND], providerId: id });
        made++;
    }
    return made;
}
