import { useEffect, useMemo, useState } from 'react';
import { signedUrls } from '../../services/chatFiles';

/** Resolves signed URLs for the given attachments; local previews win while uploading. */
export function useAttachmentUrls(items: { path: string; localUrl?: string }[]) {
    const [urls, setUrls] = useState<Record<string, string>>({});
    const key = items.filter(i => !i.localUrl).map(i => i.path).sort().join('|');
    useEffect(() => {
        let alive = true;
        const paths = key ? key.split('|') : [];
        if (!paths.length) return;
        signedUrls(paths).then(u => { if (alive) setUrls(prev => ({ ...prev, ...u })); }).catch(() => {});
        return () => { alive = false; };
    }, [key]);
    return useMemo(() => {
        const out = { ...urls };
        items.forEach(i => { if (i.localUrl) out[i.path] = i.localUrl; });
        return out;
    }, [urls, items]);
}
