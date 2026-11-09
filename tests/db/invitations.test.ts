/**
 * Workspace invitations (v27): the guest must accept or decline before joining.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { createTestDb, type TestDb } from './harness';

let t: TestDb;
beforeAll(async () => { t = await createTestDb(); }, 60_000);

async function teamOf(email: string) {
    const o = await t.signUp(email, { name: 'Owner' });
    const [ws] = await t.as<{ id: string }>(o.authId, `INSERT INTO public.workspaces (name, owner_id, currency) VALUES ('Family', $1, 'EGP') RETURNING id`, [o.userId]);
    await t.as(o.authId, `INSERT INTO public.workspace_members (workspace_id, user_id, role, status) VALUES ($1, $2, 'owner', 'active') ON CONFLICT DO NOTHING`, [ws.id, o.userId]);
    return { o, ws: ws.id };
}
const status = async (ws: string, userId: string) =>
    (await t.as<{ status: string }>('service', 'SELECT status FROM public.workspace_members WHERE workspace_id = $1 AND user_id = $2', [ws, userId]))[0]?.status ?? null;
const canSee = async (authId: string, ws: string) =>
    (await t.as(authId, 'SELECT id FROM public.workspaces WHERE id = $1', [ws])).length > 0;

describe('workspace invitations', () => {
    it('adding an existing user creates an invitation, not a membership', async () => {
        const { o, ws } = await teamOf('inv-owner1@example.test');
        const g = await t.signUp('inv-guest1@example.test', { name: 'Guest' });
        const [r] = await t.as<{ add_workspace_member: string }>(o.authId, `SELECT public.add_workspace_member($1, 'inv-guest1@example.test', 'member')`, [ws]);
        expect(r.add_workspace_member).toBe('invited');
        expect(await status(ws, g.userId)).toBe('invited');
        expect(await canSee(g.authId, ws)).toBe(false);            // nothing visible before accepting
        const notes = await t.as<{ type: string }>(g.authId, `SELECT type FROM public.notifications WHERE user_id = $1`, [g.userId]);
        expect(notes.map(n => n.type)).toContain('workspace_invite');
        const list = await t.as<{ workspace: string; role: string; inviter: string }>(g.authId, 'SELECT * FROM public.list_my_invitations()');
        expect(list).toEqual([expect.objectContaining({ workspace: 'Family', role: 'member', inviter: 'Owner' })]);
    });

    it('accepting makes them an active member and tells the owner', async () => {
        const { o, ws } = await teamOf('inv-owner2@example.test');
        const g = await t.signUp('inv-guest2@example.test', { name: 'Guest Two' });
        await t.as(o.authId, `SELECT public.add_workspace_member($1, 'inv-guest2@example.test', 'viewer')`, [ws]);
        const [r] = await t.as<{ respond_to_invitation: string }>(g.authId, 'SELECT public.respond_to_invitation($1, true)', [ws]);
        expect(r.respond_to_invitation).toBe('accepted');
        expect(await status(ws, g.userId)).toBe('active');
        expect(await canSee(g.authId, ws)).toBe(true);
        const ownerNotes = await t.as<{ message: string }>(o.authId, `SELECT message FROM public.notifications WHERE user_id = $1 AND type = 'member_joined'`, [o.userId]);
        expect(ownerNotes[0].message).toMatch(/Guest Two accepted/);
        expect(await t.as(g.authId, 'SELECT * FROM public.list_my_invitations()')).toHaveLength(0);
    });

    it('declining removes the invitation and tells the owner', async () => {
        const { o, ws } = await teamOf('inv-owner3@example.test');
        const g = await t.signUp('inv-guest3@example.test', { name: 'Guest Three' });
        await t.as(o.authId, `SELECT public.add_workspace_member($1, 'inv-guest3@example.test', 'member')`, [ws]);
        const [r] = await t.as<{ respond_to_invitation: string }>(g.authId, 'SELECT public.respond_to_invitation($1, false)', [ws]);
        expect(r.respond_to_invitation).toBe('declined');
        expect(await status(ws, g.userId)).toBeNull();
        expect(await canSee(g.authId, ws)).toBe(false);
        const ownerNotes = await t.as<{ type: string }>(o.authId, `SELECT type FROM public.notifications WHERE user_id = $1`, [o.userId]);
        expect(ownerNotes.map(n => n.type)).toContain('member_declined');
    });

    it('someone else cannot answer an invitation that is not theirs', async () => {
        const { o, ws } = await teamOf('inv-owner4@example.test');
        const g = await t.signUp('inv-guest4@example.test');
        const x = await t.signUp('inv-stranger4@example.test');
        await t.as(o.authId, `SELECT public.add_workspace_member($1, 'inv-guest4@example.test', 'member')`, [ws]);
        const [r] = await t.as<{ respond_to_invitation: string }>(x.authId, 'SELECT public.respond_to_invitation($1, true)', [ws]);
        expect(r.respond_to_invitation).toBe('not_found');
        expect(await canSee(x.authId, ws)).toBe(false);
        expect(await status(ws, g.userId)).toBe('invited');
    });

    it('an email invite for someone without an account becomes an invitation when they sign up', async () => {
        const { o, ws } = await teamOf('inv-owner5@example.test');
        const [r] = await t.as<{ add_workspace_member: string }>(o.authId, `SELECT public.add_workspace_member($1, 'inv-later5@example.test', 'member')`, [ws]);
        expect(r.add_workspace_member).toBe('pending');
        const g = await t.signUp('inv-later5@example.test');
        const [c] = await t.as<{ claim_pending_invites: number }>(g.authId, 'SELECT public.claim_pending_invites()');
        expect(c.claim_pending_invites).toBe(1);
        expect(await status(ws, g.userId)).toBe('invited');
        expect(await canSee(g.authId, ws)).toBe(false);
    });

    it('inviting the same person twice keeps one invitation', async () => {
        const { o, ws } = await teamOf('inv-owner6@example.test');
        await t.signUp('inv-guest6@example.test');
        await t.as(o.authId, `SELECT public.add_workspace_member($1, 'inv-guest6@example.test', 'member')`, [ws]);
        const [r] = await t.as<{ add_workspace_member: string }>(o.authId, `SELECT public.add_workspace_member($1, 'inv-guest6@example.test', 'admin')`, [ws]);
        expect(r.add_workspace_member).toBe('already_invited');
    });
});
