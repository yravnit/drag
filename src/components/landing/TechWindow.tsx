import { cn } from "@/lib/cn";

export interface TechWindowProps {
  title: string;
  children: React.ReactNode;
  className?: string;
}

const TRAFFIC_LIGHTS = ["bg-[#f92672]", "bg-[#fd971f]", "bg-[#a6e22e]"];

export function TechWindow({ title, children, className }: TechWindowProps) {
  return (
    <div
      className={cn(
        "flex w-full flex-col overflow-hidden rounded-[14px] border border-code-line bg-code-bg shadow-panel",
        className,
      )}
    >
      <div className="flex items-center justify-between gap-3 border-b border-code-line bg-[#1e1f1c] px-4 py-[11px]">
        <div className="flex items-center gap-[7px]">
          {TRAFFIC_LIGHTS.map((tone) => (
            <span key={tone} className={cn("inline-block size-2.5 rounded-full", tone)} />
          ))}
          <span className="ml-2 font-mono text-[11.5px] font-medium text-code-fg opacity-90">
            {title}
          </span>
        </div>
      </div>
      <div className="relative flex flex-1 flex-col justify-center px-[22px] py-5">{children}</div>
    </div>
  );
}
