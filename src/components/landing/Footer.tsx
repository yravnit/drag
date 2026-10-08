import { PAGE_CONTAINER, REPO_URL } from "./constants";

interface FooterLink {
  label: string;
  href: string;
  external?: boolean;
}

const FOOTER_SECTIONS: { heading: string; links: FooterLink[] }[] = [
  {
    heading: "Product",
    links: [
      { label: "How It Works", href: "#how-it-works" },
      { label: "Architecture Diagrams", href: "#architecture-diagrams" },
      { label: "Trust & Security", href: "#trust-security" },
    ],
  },
  {
    heading: "Connect",
    links: [{ label: "GitHub", href: REPO_URL, external: true }],
  },
];

const LINK_STYLE =
  "text-[rgba(255,255,255,0.75)] transition-colors duration-150 ease-out hover:text-white";

export function Footer({ year }: { year: number }) {
  return (
    <footer className="overflow-hidden bg-[#09090b] text-white">
      <div className={`${PAGE_CONTAINER} pt-16 max-md:pt-12`}>
        <div className="flex flex-wrap gap-x-28 gap-y-10">
          {FOOTER_SECTIONS.map((section) => (
            <div key={section.heading} className="flex flex-col gap-2.5">
              <p className="text-[13px] font-bold tracking-[1.2px] text-[#71717a] uppercase">
                {section.heading}
              </p>
              <div className="flex flex-col text-[14.5px] leading-[2.3] font-medium">
                {section.links.map((link) => (
                  <a
                    key={link.label}
                    href={link.href}
                    target={link.external ? "_blank" : undefined}
                    rel={link.external ? "noreferrer" : undefined}
                    className={LINK_STYLE}
                  >
                    {link.label}
                  </a>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>

      <p className="mt-16 bg-linear-to-t from-[rgba(255,255,255,0.02)] to-[rgba(255,255,255,0.26)] bg-clip-text text-center font-brand text-[clamp(3rem,15vw,14rem)] leading-[1.15] whitespace-nowrap text-transparent select-none">
        DRAG
      </p>

      <div className="mt-16 border-t border-[#27272a] pt-7 pb-9">
        <p className={`${PAGE_CONTAINER} text-sm font-medium text-[#d4d4d8]`}>
          © {year} DRAG. All rights reserved.
        </p>
      </div>
    </footer>
  );
}