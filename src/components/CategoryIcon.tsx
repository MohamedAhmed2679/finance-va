/**
 * The line icon for a spending category, in a neutral tile. Built-in categories map to one icon set
 * (lucide, the same as the rest of the app). A category the person created keeps the emoji they chose.
 */
import { ShoppingCart, Utensils, Bus, ShoppingBag, Clapperboard, Zap, HeartPulse, Plane, BookOpen, PiggyBank, Banknote, Package, type LucideIcon } from 'lucide-react';
import { getCategoryInfo } from '../constants';

const ICONS: Record<string, LucideIcon> = {
    groceries: ShoppingCart, dining: Utensils, transport: Bus, shopping: ShoppingBag, entertainment: Clapperboard,
    utilities: Zap, healthcare: HeartPulse, travel: Plane, education: BookOpen, savings: PiggyBank, income: Banknote, other: Package,
};

export default function CategoryIcon({ category }: { category: string }) {
    const Icon = ICONS[category];
    return (
        <div className="ledger-icon" aria-hidden="true">
            {Icon ? <Icon size={18} strokeWidth={1.75} /> : <span className="ledger-emoji">{getCategoryInfo(category).emoji}</span>}
        </div>
    );
}
