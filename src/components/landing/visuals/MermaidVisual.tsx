import { TechWindow } from "../TechWindow";

const RELATIONSHIPS = [
  { left: "customers", label: "places", right: "orders" },
  { left: "orders", label: "contains", right: "order_items" },
];

export function MermaidVisual() {
  return (
    <TechWindow title="mermaid — live diagram synthesis">
      <div className="flex flex-col gap-3 text-left">
        <div className="code-surface rounded-[8px] px-3.5 py-2.5 font-mono text-[11px] leading-[1.5]">
          <div className="tok-comment">```mermaid</div>
          <div>
            <span className="tok-keyword">erDiagram</span>
          </div>
          {RELATIONSHIPS.map((relation) => (
            <div key={relation.left} className="pl-3">
              <span className="tok-type">{relation.left}</span>{" "}
              <span className="tok-number">{"||--o{"}</span>{" "}
              <span className="tok-type">{relation.right}</span> :{" "}
              <span className="tok-string">&quot;{relation.label}&quot;</span>
            </div>
          ))}
          <div className="tok-comment">```</div>
        </div>

        <div className="rounded-[8px] border border-[#3e3d32] bg-[#1e1f1c] px-3.5 py-3 shadow-[0_2px_8px_rgba(0,0,0,0.3)]">
          <svg
            viewBox="0 0 360 76"
            role="img"
            aria-label="Entity relationship diagram of a foreign repository"
            className="block h-auto w-full"
          >
            <title>Entity relationship diagram of a foreign repository</title>
            <g fontFamily="var(--font-fira-code), monospace" fontSize="10" fontWeight="600">
              {RELATIONSHIPS.map((relation, index) => {
                const top = index === 0 ? 6 : 44;
                const textBaseline = top + 17;
                const edgeMid = top + 13;
                const labelBaseline = edgeMid - 5;
                const arrow = `M 227 ${edgeMid - 4} L 237 ${edgeMid} L 227 ${edgeMid + 4}`;
                return (
                  <g key={relation.left}>
                    <rect
                      x="8"
                      y={top}
                      width="105"
                      height="26"
                      rx="5"
                      fill="#272822"
                      stroke="#66d9ef"
                      strokeWidth="1.2"
                    />
                    <text x="60" y={textBaseline} textAnchor="middle" fill="#f8f8f2">
                      {relation.left}
                    </text>

                    <line
                      x1="113"
                      y1={edgeMid}
                      x2="237"
                      y2={edgeMid}
                      stroke="#ae81ff"
                      strokeWidth="1.2"
                      strokeDasharray="3 3"
                    />
                    <circle
                      cx="118"
                      cy={edgeMid}
                      r="2.5"
                      fill="#272822"
                      stroke="#ae81ff"
                      strokeWidth="1.2"
                    />
                    <path d={arrow} fill="none" stroke="#ae81ff" strokeWidth="1.2" />
                    <text
                      x="175"
                      y={labelBaseline}
                      textAnchor="middle"
                      fontSize="8.5"
                      fontWeight="normal"
                      fill="#e6db74"
                    >
                      {relation.label}
                    </text>

                    <rect
                      x="237"
                      y={top}
                      width="105"
                      height="26"
                      rx="5"
                      fill="#272822"
                      stroke="#66d9ef"
                      strokeWidth="1.2"
                    />
                    <text x="289" y={textBaseline} textAnchor="middle" fill="#f8f8f2">
                      {relation.right}
                    </text>
                  </g>
                );
              })}
            </g>
          </svg>
        </div>
      </div>
    </TechWindow>
  );
}
