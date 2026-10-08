import { buttonClass } from "@/components/ui/button";

/**
 * **A bar at the foot, not a pill over the page** (pixel-craft class 9, K-139):
 * the one door a long public page keeps under a phone thumb — the trip page's
 * Book, and the course page's (UX audit #8). A 70×48 pill fixed 16px off the
 * corner of a phone screen sat on the page's own controls at rest, with no room
 * reserved for it. The bar spans the screen in the chrome's materials (the page
 * ground behind a blur, one hairline, no shadow), and `data-foot-bar` is what
 * `globals.css` ends the document that much lower by, so the page's last line
 * and the shop's footer scroll clear of it. From `sm` up the page is short
 * enough to reach its own door, and the bar stands down; it never prints.
 *
 * The label is a verb and nothing else: a seat count here ("Book · 3 left")
 * repeated the fact the section it scrolls to states in its own corner (ADR
 * 20260827-the-divers-thread, decision 2).
 */
export function PhoneFootBar({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <div
      data-foot-bar=""
      className="fixed inset-x-0 bottom-0 z-20 border-t border-border bg-background/95 px-4 py-3 backdrop-blur sm:hidden print:hidden"
    >
      <a href={href} className={buttonClass({ className: "w-full" })}>
        {children}
      </a>
    </div>
  );
}
