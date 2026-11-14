'use client';

import { useEffect, useRef } from 'react';
import { animate, useReducedMotion } from 'framer-motion';

/** Ett tal som räknas upp till sitt värde. format gör om talet till text (t.ex. "1 234 kr"). */
export default function CountUp({ value, format }: { value: number; format: (n: number) => string }) {
  const ref = useRef<HTMLSpanElement>(null);
  const from = useRef(0);
  const reduce = useReducedMotion();
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (reduce || document.documentElement.dataset.motion === 'reduce') {
      el.textContent = format(value);
      from.current = value;
      return;
    }
    const controls = animate(from.current, value, {
      duration: 0.9,
      ease: [0.22, 1, 0.36, 1],
      onUpdate: (n) => (el.textContent = format(Number.isInteger(value) ? Math.round(n) : Math.round(n * 10) / 10)),
    });
    from.current = value;
    return () => controls.stop();
  }, [value, format, reduce]);
  return <span ref={ref}>{format(0)}</span>;
}
