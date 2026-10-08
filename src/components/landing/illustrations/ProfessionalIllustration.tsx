export function ProfessionalIllustration() {
  return (
    <svg
      viewBox="0 0 320 180"
      fill="none"
      role="img"
      aria-label="Illustration of a professional software engineer"
      className="h-40 w-full rounded-[10px]"
    >
      <rect width="320" height="180" rx="10" fill="var(--surface-2, #f1f5f9)" />
      <circle cx="160" cy="90" r="65" fill="#a855f7" opacity="0.15" />

      <line
        x1="20"
        y1="145"
        x2="300"
        y2="145"
        stroke="var(--line-2, #cbd5e1)"
        strokeWidth="2"
        strokeLinecap="round"
      />

      <path d="M125 145 C125 112, 140 102, 160 102 C180 102, 195 112, 195 145 Z" fill="#1e1b4b" />
      <path d="M152 102 L160 116 L168 102 Z" fill="var(--page-2, #ffffff)" />
      <path d="M158 108 L162 108 L161 126 L159 126 Z" fill="#6366f1" />

      <circle cx="160" cy="74" r="18" fill="#fed7aa" />
      <path d="M142 70 C142 58, 178 58, 178 70 Z" fill="#312e81" />
      <rect
        x="148"
        y="72"
        width="10"
        height="7"
        rx="2"
        stroke="#0f172a"
        strokeWidth="1.5"
        fill="none"
      />
      <rect
        x="162"
        y="72"
        width="10"
        height="7"
        rx="2"
        stroke="#0f172a"
        strokeWidth="1.5"
        fill="none"
      />
      <line x1="158" y1="75" x2="162" y2="75" stroke="#0f172a" strokeWidth="1.5" />

      <path
        d="M178 122 C188 112, 190 92, 172 84"
        stroke="#1e1b4b"
        strokeWidth="6"
        strokeLinecap="round"
      />
      <circle cx="170" cy="84" r="4" fill="#fed7aa" />

      <rect x="135" y="130" width="50" height="15" rx="2" fill="#0f172a" />
      <path d="M142 130 L150 112 L170 112 L178 130 Z" fill="#1e293b" />
      <rect x="151" y="116" width="18" height="10" rx="1" fill="#a855f7" opacity="0.8" />

      <g transform="translate(192, 24)">
        <rect
          width="104"
          height="66"
          rx="8"
          fill="var(--page-2, #ffffff)"
          stroke="var(--line-2, #cbd5e1)"
          strokeWidth="1.5"
        />
        <rect
          x="10"
          y="10"
          width="36"
          height="18"
          rx="3"
          fill="#f3e8ff"
          stroke="#c084fc"
          strokeWidth="1"
        />
        <text x="13" y="22" className="font-mono" fontSize="7" fontWeight="700" fill="#7e22ce">
          GATEWAY
        </text>

        <rect
          x="58"
          y="10"
          width="36"
          height="18"
          rx="3"
          fill="#e0e7ff"
          stroke="#818cf8"
          strokeWidth="1"
        />
        <text x="65" y="22" className="font-mono" fontSize="7" fontWeight="700" fill="#4338ca">
          AUTH
        </text>

        <rect
          x="34"
          y="38"
          width="36"
          height="18"
          rx="3"
          fill="#ecfdf5"
          stroke="#6ee7b7"
          strokeWidth="1"
        />
        <text x="42" y="50" className="font-mono" fontSize="7" fontWeight="700" fill="#047857">
          DB/SQL
        </text>

        <line
          x1="46"
          y1="19"
          x2="58"
          y2="19"
          stroke="#94a3b8"
          strokeWidth="1"
          strokeDasharray="2 2"
        />
        <line
          x1="52"
          y1="28"
          x2="52"
          y2="38"
          stroke="#94a3b8"
          strokeWidth="1"
          strokeDasharray="2 2"
        />
      </g>

      <g transform="translate(36, 36)">
        <rect
          width="50"
          height="26"
          rx="6"
          fill="var(--page-2, #ffffff)"
          stroke="var(--line-2, #cbd5e1)"
          strokeWidth="1"
        />
        <circle cx="16" cy="13" r="5" fill="#a855f7" />
        <text x="26" y="17" className="font-mono" fontSize="8" fontWeight="700" fill="#6b21a8">
          JWT
        </text>
      </g>
    </svg>
  );
}
