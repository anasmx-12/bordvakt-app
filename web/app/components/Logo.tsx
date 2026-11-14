export default function Logo() {
  return (
    <div className="flex items-center gap-2.5 text-ink">
      <svg width="30" height="30" viewBox="0 0 32 32" fill="none" aria-hidden="true">
        <rect x="1" y="1" width="30" height="30" rx="9" fill="#0F1419" />
        <path
          d="M6 16c2.8-4.6 6.2-7 10-7s7.2 2.4 10 7c-2.8 4.6-6.2 7-10 7s-7.2-2.4-10-7z"
          stroke="#FFFFFF"
          strokeWidth="2"
        />
        <circle cx="16" cy="16" r="3.2" fill="#FB923C" />
      </svg>
      <span className="font-display text-[21px] font-bold tracking-[-0.02em]">Bordvakt</span>
    </div>
  );
}
