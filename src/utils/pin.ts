/** PINs are stored as salted SHA-256 hashes ("sha256:<hex>"), never as plain digits. */
export async function hashPin(pin: string, salt: string): Promise<string> {
    const data = new TextEncoder().encode(`${salt}:${pin}`);
    const buf = await crypto.subtle.digest('SHA-256', data);
    return 'sha256:' + Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
}

export async function pinMatches(entry: string, stored: string | undefined, salt: string): Promise<boolean> {
    if (!stored) return false;
    if (stored.startsWith('sha256:')) return (await hashPin(entry, salt)) === stored;
    return entry === stored; // legacy plain PIN — caller upgrades it to a hash
}
