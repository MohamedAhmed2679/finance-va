/**
 * Hands messages from the Android receiver to the pipeline. The receiver keeps them (bank and
 * wallet senders only) until Zaylo confirms each one was handled, so nothing is lost if the app is
 * closed, offline or interrupted, and repeats are harmless because storing is idempotent.
 */
import { ZayloSms, nativeStatus, deviceState } from './native';
import { processMessage, flushOutbox, type ProcessResult } from './service';
import { knownSenders } from './senders';

let running: Promise<ProcessResult[]> | null = null;

export async function drainAndroid(): Promise<ProcessResult[]> {
    if (running) return running;
    running = (async () => {
        const st = await nativeStatus();
        if (deviceState(st) !== 'enabled') return [];
        await flushOutbox().catch(() => 0);
        const { messages } = await ZayloSms.drain();
        const results: ProcessResult[] = [];
        const done: string[] = [];
        for (const m of messages) {
            try {
                const r = await processMessage({ text: m.body, sender: m.sender, receivedAt: new Date(m.receivedAt), ingestion: 'android' });
                results.push(r);
                if (r.outcome !== 'failed') done.push(m.id);
            } catch { /* stays on the device for the next try */ }
        }
        if (done.length) await ZayloSms.acknowledge({ ids: done });
        return results;
    })().finally(() => { running = null; });
    return running;
}

/** Sender names the receiver should keep (everything else is dropped on the device immediately). */
export const receiverSenders = (custom: string[]) => [...new Set([...knownSenders().flatMap(k => k.match), ...custom].map(s => s.toLowerCase().replace(/[\s_.]/g, '')))];
