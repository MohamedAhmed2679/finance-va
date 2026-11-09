import { useEffect, useRef, useState } from 'react';
import { useReducedMotion } from 'framer-motion';

/** Animated number that eases from its previous value to the next one. */
export function useCountUp(target: number, duration = 900) {
    const reduce = useReducedMotion();
    const [value, setValue] = useState(reduce ? target : 0);
    const from = useRef(reduce ? target : 0);
    useEffect(() => {
        if (reduce) { from.current = target; return; }
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
    return reduce ? target : value;
}
