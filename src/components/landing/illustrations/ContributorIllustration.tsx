export function ContributorIllustration() {
  return (
    <svg
      viewBox="0 0 320 180"
      fill="none"
      role="img"
      aria-label="Illustration of an open source contributor"
      className="h-40 w-full rounded-[10px]"
    >
      <rect width="320" height="180" rx="10" fill="var(--surface-2, #f1f5f9)" />
      <circle cx="160" cy="90" r="65" fill="#10b981" opacity="0.15" />

      <line
        x1="20"
        y1="145"
        x2="300"
        y2="145"
        stroke="var(--line-2, #cbd5e1)"
        strokeWidth="2"
        strokeLinecap="round"
      />

      <path d="M125 145 C125 112, 140 102, 160 102 C180 102, 195 112, 195 145 Z" fill="#059669" />

      <circle cx="160" cy="74" r="18" fill="#fed7aa" />
      <path d="M142 70 C142 56, 178 56, 178 70 Z" fill="#0f172a" />
      <rect x="140" y="68" width="40" height="5" rx="2" fill="#334155" />

      <path
        d="M130 118 C115 112, 110 96, 125 88"
        stroke="#059669"
        strokeWidth="6"
        strokeLinecap="round"
      />
      <g transform="translate(118, 75) rotate(-30)">
        <path d="M0 0 L4 18 L8 18 L12 0 Z" fill="#64748b" />
        <circle cx="6" cy="2" r="5" fill="#94a3b8" />
        <circle cx="6" cy="2" r="2" fill="var(--page-2, #ffffff)" />
      </g>

      <rect x="135" y="130" width="50" height="15" rx="2" fill="#0f172a" />
      <path d="M142 130 L150 112 L170 112 L178 130 Z" fill="#1e293b" />
      <circle cx="160" cy="120" r="4" fill="#10b981" />

      <g transform="translate(198, 26)">
        <rect
          width="98"
          height="62"
          rx="8"
          fill="var(--page-2, #ffffff)"
          stroke="var(--line-2, #cbd5e1)"
          strokeWidth="1.5"
        />
        <circle cx="22" cy="22" r="5" fill="#10b981" />
        <circle cx="22" cy="42" r="5" fill="#3b82f6" />
        <circle cx="70" cy="22" r="5" fill="#10b981" />
        <circle cx="56" cy="42" r="5" fill="#f59e0b" />

        <line x1="22" y1="22" x2="70" y2="22" stroke="#10b981" strokeWidth="1.8" />
        <path d="M22 22 C40 22, 40 42, 56 42" stroke="#3b82f6" strokeWidth="1.8" fill="none" />
      </g>

      <g transform="translate(40, 38)">
        <circle
          cx="20"
          cy="20"
          r="15"
          stroke="#10b981"
          strokeWidth="3"
          strokeDasharray="4 2"
          fill="var(--page-2, #ffffff)"
        />
        <circle cx="20" cy="20" r="6" fill="#10b981" />
      </g>
    </svg>
  );
}
