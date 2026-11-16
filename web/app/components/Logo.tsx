export default function Logo() {
  return (
    <div className="flex items-center gap-2.5 text-ink">
      {/* logo-mark lutar logotypen vid hovring (globals.css) */}
      <svg className="logo-mark" width="30" height="30" viewBox="0 0 32 32" fill="none" aria-hidden="true">
        <defs>
          <linearGradient id="logo-bg" x1="0" y1="0" x2="32" y2="32" gradientUnits="userSpaceOnUse">
            <stop offset="0" stopColor="#0B1820" />
            <stop offset="1" stopColor="#02070A" />
          </linearGradient>
          <linearGradient id="logo-ring" x1="0" y1="0" x2="32" y2="32" gradientUnits="userSpaceOnUse">
            <stop offset="0" stopColor="#0297DE" />
            <stop offset="1" stopColor="#FC734D" />
          </linearGradient>
        </defs>
        <rect x="1" y="1" width="30" height="30" rx="9" fill="url(#logo-bg)" stroke="url(#logo-ring)" strokeOpacity="0.7" />
        <g className="logo-eye">
          <path
            d="M6 16c2.8-4.6 6.2-7 10-7s7.2 2.4 10 7c-2.8 4.6-6.2 7-10 7s-7.2-2.4-10-7z"
            stroke="#FFFFFF"
            strokeWidth="2"
          />
          <g className="logo-pupil">
            <circle cx="16" cy="16" r="3.2" fill="#FC734D" />
            <circle cx="15" cy="15" r="1" fill="#FFFFFF" />
          </g>
        </g>
      </svg>
      <span className="font-display text-[21px] font-bold tracking-[-0.02em]">Bordvakt</span>
    </div>
  );
}
