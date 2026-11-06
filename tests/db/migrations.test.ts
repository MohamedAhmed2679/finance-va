import { describe, it, expect } from 'vitest';
import { createTestDb } from './harness';

describe('migrations', () => {
    it('apply on a clean Postgres', async () => {
        const t = await createTestDb();
        console.log('applied', t.applied.length, 'skipped', JSON.stringify(t.skipped, null, 1));
        expect(t.applied.length).toBeGreaterThan(10);
    }, 120_000);
});
