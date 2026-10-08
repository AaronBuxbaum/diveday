/**
 * "Skip to main content" — visually hidden until it receives keyboard focus,
 * then jumps a keyboard user past whatever comes before `href`'s target
 * (a header, a nav bar) straight to the page's real content. Originated in
 * the offline manifest (the one page that had a real skip link); generalized
 * here so every page gets one instead of just two (docs/product/assessments
 * ux-personas-20260730-findings.md, persona 14 — a staff page fronts 10-15 header tab
 * stops before this).
 *
 * **One per page.** The root layout renders one (`level="root"`), a shell
 * that brings its own header renders another (`"shell"`: the staff chrome, a
 * shop's public chrome) and a page with a destination better than its main
 * landmark a third (`"page"`: the manifest's roll call). Every one of them
 * used to reach the focus trail, so the first two Tabs on every staff page
 * were the same link (UX audit 2026-10-07, item 29). `globals.css` now hides
 * every level below the deepest one present, by `:has()`, so the link a
 * keyboard user meets first is the one that skips the most.
 */
export type SkipLinkLevel = "root" | "shell" | "page";

export function SkipLink({
  href,
  label,
  level,
}: {
  href: string;
  label: string;
  level: SkipLinkLevel;
}) {
  return (
    <a
      href={href}
      data-skip-link={level}
      className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-50 focus:rounded-lg focus:bg-primary focus:px-4 focus:py-3 focus:text-primary-foreground"
    >
      {label}
    </a>
  );
}
