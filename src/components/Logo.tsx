/** ひかげみちのロゴ: 太陽の下、建物の影に沿って涼しく伸びる道 */
export function LogoMark({ className = "h-8 w-8" }: { className?: string }) {
  return (
    <svg viewBox="0 0 40 40" className={className} aria-hidden="true" focusable="false">
      <defs>
        <linearGradient id="sun-grad" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#f59e0b" />
          <stop offset="100%" stopColor="#d97706" />
        </linearGradient>
        <linearGradient id="shade-grad" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#228569" />
          <stop offset="100%" stopColor="#145241" />
        </linearGradient>
        <linearGradient id="path-grad" x1="0%" y1="0%" x2="100%" y2="0%">
          <stop offset="0%" stopColor="#1b4b72" />
          <stop offset="100%" stopColor="#2563eb" />
        </linearGradient>
      </defs>
      {/* 太陽（日差し） */}
      <circle cx="28" cy="11" r="6.5" fill="url(#sun-grad)" />
      {/* 太陽の繊細な光輪 */}
      <circle cx="28" cy="11" r="8.5" fill="none" stroke="var(--sun)" strokeWidth="0.8" opacity="0.4" strokeDasharray="2 2" />
      {/* 建物の日陰 */}
      <path d="M5 33 L17 17 L17 33 Z" fill="url(#shade-grad)" />
      {/* 日陰に寄り添い伸びる道 */}
      <path d="M7 35 C 14 30, 20 27, 36 26" fill="none" stroke="var(--ai)" strokeWidth="3.2" strokeLinecap="round" />
    </svg>
  );
}
