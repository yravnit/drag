export const REPO_URL = "https://github.com/yravnit/drag";

export const PAGE_CONTAINER = "mx-auto w-full max-w-[1340px] px-5 md:px-20";

const CTA_BASE =
  "inline-flex items-center justify-center gap-2 rounded-[8px] font-semibold no-underline tracking-[-0.02em] transition-[background-color,border-color,color,box-shadow,transform] duration-150 ease-out active:scale-[0.96]";

export const PRIMARY_CTA = `${CTA_BASE} bg-btn text-btn-fg shadow-[0_4px_14px_rgba(0,0,0,0.16)] hover:bg-btn-hover hover:shadow-[0_6px_20px_rgba(0,0,0,0.22)] active:shadow-[0_2px_8px_rgba(0,0,0,0.12)]`;

export const OUTLINE_CTA = `${CTA_BASE} bg-btn-o border border-btn-o-line text-btn-o-fg hover:border-line-2 hover:bg-btn-o-hover`;
