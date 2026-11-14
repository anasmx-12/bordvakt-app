'use client';

import { useId } from 'react';

export type VaktiMood = 'idle' | 'thinking' | 'worried' | 'happy';

interface Props {
  mood?: VaktiMood;
  size?: number;
  className?: string;
}

/** Vakti: Bordvakts maskot, en liten matkupa med ögon och servettrosett.
 *  idle = gungar och blinkar, thinking = lyfter på locket, worried = bekymrad, happy = glad med konfetti.
 *  Rörelserna stängs av för den som valt "minska rörelser". */
export default function Vakti({ mood = 'idle', size = 56, className = '' }: Props) {
  const id = useId().replace(/:/g, '');
  const happy = mood === 'happy';
  const worried = mood === 'worried';

  return (
    <svg
      viewBox="0 0 120 120"
      width={size}
      height={size}
      aria-hidden="true"
      className={`${mood === 'worried' ? 'animate-vakti-shake' : 'animate-vakti-bob'} ${className}`}
    >
      <defs>
        <linearGradient id={`dome-${id}`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#F8FAFC" />
          <stop offset="0.55" stopColor="#D5DCE3" />
          <stop offset="1" stopColor="#A9B4BF" />
        </linearGradient>
        <radialGradient id={`glow-${id}`} cx="0.5" cy="0.5" r="0.5">
          <stop offset="0" stopColor="#FDE68A" />
          <stop offset="1" stopColor="#FDE68A" stopOpacity="0" />
        </radialGradient>
      </defs>

      {/* Skugga och tallrik */}
      <ellipse cx="60" cy="108" rx="40" ry="5" fill="#0F1419" opacity="0.12" />
      <ellipse cx="60" cy="97" rx="48" ry="9" fill="#FFFFFF" stroke="#CBD5E1" strokeWidth="2" />

      {/* Ljuset under locket när Vakti tänker */}
      {mood === 'thinking' && <ellipse cx="60" cy="90" rx="30" ry="9" fill={`url(#glow-${id})`} />}

      {/* Locket med ansiktet */}
      <g className={mood === 'thinking' ? 'animate-vakti-lift' : ''}>
        <path d="M17 92 A43 45 0 0 1 103 92 Z" fill={`url(#dome-${id})`} stroke="#94A3B8" strokeWidth="2" />
        <path d="M32 70 Q38 54 52 49" fill="none" stroke="#FFFFFF" strokeWidth="5" strokeLinecap="round" opacity="0.8" />
        <rect x="14" y="89" width="92" height="6" rx="3" fill="#B6C0CA" />
        <circle cx="60" cy="44" r="7" fill="#C2CBD4" stroke="#94A3B8" strokeWidth="2" />

        {/* Ögon */}
        {happy ? (
          <g fill="none" stroke="#0F1419" strokeWidth="3.5" strokeLinecap="round">
            <path d="M40 73 Q46 66 52 73" />
            <path d="M68 73 Q74 66 80 73" />
          </g>
        ) : (
          <g className="animate-vakti-blink">
            <ellipse cx="46" cy="72" rx="5.5" ry={worried ? 5 : 6.5} fill="#0F1419" />
            <ellipse cx="74" cy="72" rx="5.5" ry={worried ? 5 : 6.5} fill="#0F1419" />
            <circle cx="48" cy="69.5" r="1.8" fill="#FFFFFF" />
            <circle cx="76" cy="69.5" r="1.8" fill="#FFFFFF" />
          </g>
        )}
        {worried && (
          <g stroke="#0F1419" strokeWidth="2.5" strokeLinecap="round">
            <path d="M39 62 L51 65" />
            <path d="M81 62 L69 65" />
          </g>
        )}

        {/* Kinder och mun */}
        <circle cx="37" cy="82" r="4.5" fill="#FB7185" opacity="0.45" />
        <circle cx="83" cy="82" r="4.5" fill="#FB7185" opacity="0.45" />
        {mood === 'thinking' ? (
          <circle cx="60" cy="83" r="3" fill="#0F1419" />
        ) : worried ? (
          <path d="M53 86 Q60 80 67 86" fill="none" stroke="#0F1419" strokeWidth="3" strokeLinecap="round" />
        ) : (
          <path d="M52 81 Q60 89 68 81" fill="none" stroke="#0F1419" strokeWidth="3" strokeLinecap="round" />
        )}
      </g>

      {/* Servettrosett */}
      <g fill="var(--color-accent)">
        <path d="M60 101 L47 95 L47 107 Z" />
        <path d="M60 101 L73 95 L73 107 Z" />
        <circle cx="60" cy="101" r="3.5" />
      </g>

      {/* Konfetti när allt är klart */}
      {happy && (
        <g>
          <circle className="animate-vakti-pop" cx="18" cy="40" r="3" fill="#F59E0B" />
          <rect className="animate-vakti-pop [animation-delay:.4s]" x="98" y="34" width="6" height="6" rx="1" fill="#14B8A6" />
          <circle className="animate-vakti-pop [animation-delay:.8s]" cx="104" cy="62" r="2.5" fill="#FB7185" />
          <rect className="animate-vakti-pop [animation-delay:1.1s]" x="12" y="66" width="5" height="5" rx="1" fill="var(--color-accent)" />
        </g>
      )}
    </svg>
  );
}
