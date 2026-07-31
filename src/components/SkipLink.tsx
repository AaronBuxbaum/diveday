/**
 * "Skip to main content" — visually hidden until it receives keyboard focus,
 * then jumps a keyboard user past whatever comes before `href`'s target
 * (a header, a nav bar) straight to the page's real content. Originated in
 * the offline manifest (the one page that had a real skip link); generalized
 * here so every page gets one instead of just two (docs/product/assessments
 * ux-personas-20260730-findings.md, persona 14 — a staff page fronts 10-15 header tab
 * stops before this).
 */
export function SkipLink({ href, label }: { href: string; label: string }) {
  return (
    <a
      href={href}
      className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-50 focus:rounded-lg focus:bg-primary focus:px-4 focus:py-3 focus:text-primary-foreground"
    >
      {label}
    </a>
  );
}
