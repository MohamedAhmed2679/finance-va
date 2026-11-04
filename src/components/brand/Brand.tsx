import { useEffect, useMemo, useRef, useState } from 'react';
import { motion, useReducedMotion } from 'framer-motion';

/** Brass seal monogram — the Finance VA mark. */
export function Seal({ size = 34, tone = 'brass' }: { size?: number; tone?: 'brass' | 'ink' | 'paper' }) {
    const ring = tone === 'brass' ? 'var(--brass)' : tone === 'paper' ? '#E9F2EC' : 'var(--ink)';
    const text = tone === 'paper' ? '#E9F2EC' : tone === 'brass' ? 'var(--brass)' : 'var(--ink)';
    const teeth = 36;
    const outer = 23, inner = 21;
    let d = '';
    for (let i = 0; i <= teeth * 2; i++) {
        const a = (i / (teeth * 2)) * Math.PI * 2;
        const r = i % 2 === 0 ? outer : inner;
        d += `${i === 0 ? 'M' : 'L'}${(24 + r * Math.cos(a)).toFixed(2)},${(24 + r * Math.sin(a)).toFixed(2)}`;
    }
    return (
        <svg width={size} height={size} viewBox="0 0 48 48" aria-hidden="true">
            <path d={d + 'Z'} fill="none" stroke={ring} strokeWidth="1.4" />
            <circle cx="24" cy="24" r="17" fill="none" stroke={ring} strokeWidth="0.8" strokeDasharray="1.2 1.6" />
            <text x="24" y="29" textAnchor="middle" fontFamily="Bricolage Grotesque Variable, Bricolage Grotesque, sans-serif" fontWeight="700" fontSize="15" letterSpacing="-0.5" fill={text}>FV</text>
        </svg>
    );
}

/**
 * Banknote guilloché: interleaved sine ribbons plus a rosette.
 * Drawn once on mount (stroke reveal), then static.
 */
export function Guilloche({ width = 800, height = 260, rosette = true, seed = 0, rosetteX = 0.86, ribbonY = 0.8 }: { width?: number; height?: number; rosette?: boolean; seed?: number; rosetteX?: number; ribbonY?: number }) {
    const reduce = useReducedMotion();
    const paths = useMemo(() => {
        const out: string[] = [];
        const lines = 16;
        for (let i = 0; i < lines; i++) {
            const phase = (i / lines) * Math.PI * 2 + seed;
            let d = '';
            for (let x = 0; x <= width; x += 6) {
                const env = 0.55 + 0.45 * Math.sin((x / width) * Math.PI);
                const y = height * ribbonY
                    + Math.sin(x / 46 + phase) * 26 * env
                    + Math.sin(x / 113 - phase * 0.5) * 18;
                d += `${x === 0 ? 'M' : 'L'}${x},${y.toFixed(1)}`;
            }
            out.push(d);
        }
        if (rosette) {
            const cx = width * rosetteX, cy = height * 0.36;
            for (let k = 0; k < 9; k++) {
                let d = '';
                const R = 54 + k * 5;
                for (let s = 0; s <= 360; s += 2) {
                    const a = (s * Math.PI) / 180;
                    const r = R + 9 * Math.sin(12 * a + k * 0.7);
                    d += `${s === 0 ? 'M' : 'L'}${(cx + r * Math.cos(a)).toFixed(1)},${(cy + r * Math.sin(a)).toFixed(1)}`;
                }
                out.push(d + 'Z');
            }
        }
        return out;
    }, [width, height, rosette, seed, rosetteX, ribbonY]);

    return (
        <div className="note-guilloche" aria-hidden="true">
            <svg viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="xMidYMid slice">
                {paths.map((d, i) => (
                    <motion.path
                        key={i}
                        d={d}
                        initial={reduce ? false : { pathLength: 0 }}
                        animate={{ pathLength: 1 }}
                        transition={{ duration: 1.6, delay: i * 0.035, ease: [0.22, 1, 0.36, 1] }}
                    />
                ))}
            </svg>
        </div>
    );
}

/** Animated number that eases from its previous value to the next one. */
export function useCountUp(target: number, duration = 900) {
    const reduce = useReducedMotion();
    const [value, setValue] = useState(reduce ? target : 0);
    const from = useRef(reduce ? target : 0);
    useEffect(() => {
        if (reduce) { setValue(target); from.current = target; return; }
        const start = performance.now();
        const begin = from.current;
        let raf = 0;
        const tick = (now: number) => {
            const p = Math.min(1, (now - start) / duration);
            const eased = 1 - Math.pow(1 - p, 4);
            setValue(begin + (target - begin) * eased);
            if (p < 1) raf = requestAnimationFrame(tick);
            else from.current = target;
        };
        raf = requestAnimationFrame(tick);
        return () => cancelAnimationFrame(raf);
    }, [target, duration, reduce]);
    return value;
}
