import toast from 'react-hot-toast';
import { Copy, Share2 } from 'lucide-react';
import { useStore } from '../store/useStore';

/** The user's Zaylo ID: what others type to add them to a workspace. */
export default function ZayloIdCard() {
    const user = useStore(s => s.user);
    const id = user?.referralCode?.startsWith('ZY-') ? user.referralCode : user?.referralCode?.replace(/^FV-/, 'ZY-');
    if (!id) return null;
    const message = `Add me on Zaylo with my ID ${id} (or my email ${user?.email}).`;
    const copy = async () => { try { await navigator.clipboard.writeText(id); toast.success('Zaylo ID copied'); } catch { toast.error("Couldn't copy. Press and hold the ID to copy it."); } };
    const share = async () => {
        if (navigator.share) { try { await navigator.share({ title: 'My Zaylo ID', text: message }); return; } catch { /* cancelled */ } }
        window.open(`https://wa.me/?text=${encodeURIComponent(message)}`, '_blank', 'noopener');
    };
    return (
        <section className="zid-card" aria-label="Your Zaylo ID">
            <div>
                <div className="zid-label">Your Zaylo ID</div>
                <div className="zid-value" aria-live="polite">{id}</div>
                <p className="zid-hint">Share it so people can add you to their workspace.</p>
            </div>
            <div className="zid-actions">
                <button className="btn btn-secondary btn-sm" onClick={copy}><Copy size={15} /> Copy</button>
                <button className="btn btn-primary btn-sm" onClick={share}><Share2 size={15} /> Share</button>
            </div>
        </section>
    );
}
