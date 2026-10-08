export function StudentIllustration() {
  return (
    <svg
      viewBox="0 0 320 180"
      fill="none"
      role="img"
      aria-label="Illustration of a student exploring code"
      className="h-40 w-full rounded-[10px]"
    >
      <rect width="320" height="180" rx="10" fill="var(--surface-2, #f1f5f9)" />
      <circle cx="160" cy="90" r="65" fill="#6366f1" opacity="0.15" />

      <line
        x1="20"
        y1="145"
        x2="300"
        y2="145"
        stroke="var(--line-2, #cbd5e1)"
        strokeWidth="2"
        strokeLinecap="round"
      />

      <rect x="36" y="135" width="44" height="8" rx="2" fill="#94a3b8" />
      <rect x="34" y="127" width="48" height="8" rx="2" fill="#6366f1" />
      <rect x="38" y="119" width="40" height="8" rx="2" fill="#38bdf8" />

      <path d="M125 145 C125 112, 140 102, 160 102 C180 102, 195 112, 195 145 Z" fill="#475569" />
      <path d="M144 102 L160 122 L176 102" stroke="#64748b" strokeWidth="2" fill="none" />

      <circle cx="160" cy="74" r="22" fill="#6366f1" />
      <circle cx="160" cy="76" r="16" fill="#fed7aa" />
      <path
        d="M146 72 C146 63, 154 60, 160 60 C168 60, 174 63, 174 72 C170 70, 150 70, 146 72 Z"
        fill="#334155"
      />

      <path
        d="M178 118 C192 108, 194 86, 180 75"
        stroke="#475569"
        strokeWidth="6"
        strokeLinecap="round"
      />
      <circle cx="180" cy="74" r="4" fill="#fed7aa" />

      <rect x="135" y="130" width="50" height="15" rx="2" fill="#0f172a" />
      <path d="M142 130 L150 112 L170 112 L178 130 Z" fill="#1e293b" />
      <rect x="151" y="116" width="18" height="10" rx="1" fill="#38bdf8" opacity="0.8" />

      <g transform="translate(195, 28)">
        <rect
          width="92"
          height="46"
          rx="8"
          fill="var(--page-2, #ffffff)"
          stroke="var(--line-2, #cbd5e1)"
          strokeWidth="1.5"
        />
        <path d="M10 46 L18 52 L22 46 Z" fill="var(--page-2, #ffffff)" />
        <path d="M10 46 L18 52 L22 46" stroke="var(--line-2, #cbd5e1)" strokeWidth="1.5" />
        <text x="16" y="27" className="font-mono" fontSize="14" fontWeight="700" fill="#6366f1">
          ???
        </text>
        <text x="52" y="27" className="font-mono" fontSize="13" fontWeight="700" fill="#0ea5e9">
          {"{ }"}
        </text>
        <circle cx="78" cy="16" r="3.5" fill="#eab308" />
      </g>

      <g opacity="0.85">
        <rect
          x="32"
          y="32"
          width="56"
          height="22"
          rx="4"
          fill="var(--page-2, #ffffff)"
          stroke="var(--line-2, #cbd5e1)"
          strokeWidth="1"
        />
        <text
          x="38"
          y="47"
          className="font-mono"
          fontSize="9"
          fontWeight="600"
          fill="var(--ink-2, #334155)"
        >
          /src/core
        </text>
        <line x1="60" y1="54" x2="60" y2="68" stroke="var(--line-2, #cbd5e1)" strokeWidth="1.5" />
        <rect
          x="38"
          y="68"
          width="52"
          height="20"
          rx="4"
          fill="var(--page-2, #ffffff)"
          stroke="var(--line-2, #cbd5e1)"
          strokeWidth="1"
        />
        <text x="44" y="82" className="font-mono" fontSize="8.5" fill="var(--ink-3, #475569)">
          models/
        </text>
      </g>
    </svg>
  );
}
