import { useStore } from '../store/useStore';
import { tx } from '../i18n/translations';
import { groupOf, navLabel } from './nav';

/** Phone only: the pages inside the current destination (for example Expenses, Income, AutoTrack, History). */
export default function SectionTabs({ active, onNavigate }: { active: string; onNavigate: (page: string) => void }) {
    const lang = useStore(s => s.user?.language ?? 'en');
    const g = groupOf(active);
    if (!g || g.items.length < 2) return null;
    return (
        <nav className="section-tabs" aria-label={tx(g.label)}>
            {g.items.map(item => (
                <button key={item.key} className={active === item.key ? 'active' : ''} aria-current={active === item.key ? 'page' : undefined} onClick={() => onNavigate(item.key)}>
                    {navLabel(lang, item)}
                </button>
            ))}
        </nav>
    );
}
