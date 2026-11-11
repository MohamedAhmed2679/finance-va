import { useId } from 'react';
import { motion, useReducedMotion } from 'framer-motion';

/** Geometry from the Zaylo brand kit (01_Logos/SVG). Do not alter. */
const Z_PATH = 'M18 18 H82 L18 82 H82';
const GRADIENT_STOPS = [
    { offset: 0, color: '#22D3EE' },
    { offset: 0.45, color: '#2563FF' },
    { offset: 1, color: '#7C3AED' },
];

function BrandGradient({ id }: { id: string }) {
    return (
        <linearGradient id={id} x1="0" y1="0" x2="1" y2="1">
            {GRADIENT_STOPS.map(s => <stop key={s.offset} offset={s.offset} stopColor={s.color} />)}
        </linearGradient>
    );
}

type MarkTone = 'gradient' | 'white' | 'ink';

/** The Z mark. Gradient on any background; white on Midnight/photos; ink for mono. */
export function ZayloMark({ size = 32, tone = 'gradient', title }: { size?: number; tone?: MarkTone; title?: string }) {
    const gid = useId().replace(/:/g, '');
    const stroke = tone === 'gradient' ? `url(#zg${gid})` : tone === 'white' ? '#FFFFFF' : 'var(--ink)';
    return (
        <svg width={size} height={size} viewBox="0 0 100 100" role={title ? 'img' : undefined} aria-label={title} aria-hidden={title ? undefined : true}>
            <defs><BrandGradient id={`zg${gid}`} /></defs>
            <path d={Z_PATH} fill="none" stroke={stroke} strokeWidth="26" strokeLinejoin="round" strokeLinecap="round" />
        </svg>
    );
}

/** App-icon tile: the gradient Z on a Midnight rounded square. */
export function ZayloAppIcon({ size = 40 }: { size?: number }) {
    const gid = useId().replace(/:/g, '');
    return (
        <svg width={size} height={size} viewBox="0 0 1024 1024" aria-hidden="true">
            <defs><BrandGradient id={`ai${gid}`} /></defs>
            <rect width="1024" height="1024" rx="224" fill="#0B0F1A" />
            <path transform="translate(192,192) scale(6.4)" d={Z_PATH} fill="none" stroke={`url(#ai${gid})`} strokeWidth="26" strokeLinejoin="round" strokeLinecap="round" />
        </svg>
    );
}

/** Mark + wordmark. `onDark` switches the wordmark to white (logo rules). */
export function ZayloLogo({ size = 28, onDark = false, mono = false, suffix }: { size?: number; onDark?: boolean; mono?: boolean; suffix?: string }) {
    return (
        <span className="zaylo-logo" style={{ fontSize: size * 0.82, color: onDark ? '#FFFFFF' : 'var(--ink)' }}>
            <ZayloMark size={size} tone={mono ? (onDark ? 'white' : 'ink') : 'gradient'} />
            <span className="zaylo-wordmark">Zaylo</span>
            {suffix && <span className="zaylo-suffix">{suffix}</span>}
        </span>
    );
}

/**
 * Brand element: "A motion that moves with you."
 * Layered gradient ribbons that draw in once, then drift very slowly.
 */
export function ZayloWave({ className = '', intensity = 1, still = false }: { className?: string; intensity?: number; still?: boolean }) {
    const reduce = useReducedMotion() || still;
    const gid = useId().replace(/:/g, '');
    const ribbons = [
        { d: 'M-40 420 C260 120 520 90 820 300 S1300 540 1640 190', w: 92, o: 0.95 },
        { d: 'M-40 470 C300 200 560 170 840 360 S1320 560 1640 260', w: 2, o: 0.55 },
        { d: 'M-40 500 C320 240 580 220 860 400 S1330 590 1640 300', w: 2, o: 0.35 },
        { d: 'M-40 380 C240 60 500 40 800 250 S1290 500 1640 140', w: 2, o: 0.45 },
        { d: 'M-40 340 C220 10 480 0 780 210 S1280 470 1640 100', w: 1.5, o: 0.25 },
    ];
    return (
        <div className={`zaylo-wave ${className}`} aria-hidden="true">
            <svg viewBox="0 0 1600 600" preserveAspectRatio="xMidYMid slice">
                <defs>
                    <BrandGradient id={`w${gid}`} />
                </defs>
                <motion.g
                    animate={reduce ? undefined : { x: [0, -24, 0], y: [0, 10, 0] }}
                    transition={{ duration: 18, repeat: Infinity, ease: 'easeInOut' }}
                >
                    {ribbons.map((r, i) => (
                        <motion.path
                            key={i}
                            d={r.d}
                            fill="none"
                            stroke={`url(#w${gid})`}
                            strokeWidth={r.w}
                            strokeLinecap="round"
                            opacity={r.o * intensity}
                            initial={reduce ? false : { pathLength: 0 }}
                            animate={{ pathLength: 1 }}
                            transition={{ duration: 1.4, delay: 0.1 + i * 0.08, ease: [0.22, 1, 0.36, 1] }}
                        />
                    ))}
                </motion.g>
            </svg>
        </div>
    );
}

/** Brand pattern: repeating outlined Z marks, for depth on Midnight surfaces. */
export function ZPattern({ className = '', opacity = 0.1 }: { className?: string; opacity?: number }) {
    const pid = useId().replace(/:/g, '');
    return (
        <svg className={`zaylo-pattern ${className}`} aria-hidden="true" width="100%" height="100%">
            <defs>
                <pattern id={`p${pid}`} width="120" height="120" patternUnits="userSpaceOnUse" patternTransform="rotate(-8)">
                    <path transform="translate(30,30) scale(0.6)" d={Z_PATH} fill="none" stroke="#5B8CFF" strokeWidth="5" strokeLinejoin="round" strokeLinecap="round" />
                </pattern>
            </defs>
            <rect width="100%" height="100%" fill={`url(#p${pid})`} opacity={opacity} />
        </svg>
    );
}
