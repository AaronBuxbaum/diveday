"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";

export type KnownDiverPanelProps = {
  /** The diver's name, for the heading and the "Not you?" line. */
  name: string;
  /** The standing facts, already worded server-side, each naming its date. */
  lines: string[];
  /** The same page with no handoff on it — the cold form that ships. */
  blankHref: string;
  /** The handoff itself, so the booking that follows consumes it. */
  handoff: string;
  /**
   * Set when the panel speaks for a signed-in diver rather than a handoff (ADR
   * 20261125-diver-sign-in): the way out is signing out, not a blank form.
   */
  signOut?: () => Promise<void>;
};

/**
 * **The door remembers who opened it** (ADR 20260906-before-you-ask, decision
 * 3). Rendered inside the booking form only when the page was reached through
 * a diver's own handoff: the facts the shop already holds, each naming the day
 * it was kept, and beneath them the one way out. Every fact is a fact —
 * nothing here is a field, because nothing here may be changed on this page.
 * The lead's name, email and phone are prefilled into the form's own fields,
 * which are the doors to change those.
 *
 * A cold visitor never sees this component: the page renders it only off a
 * verified handoff, and the composition test pins that.
 */
export function KnownDiverPanel({
  name,
  lines,
  blankHref,
  handoff,
  signOut,
}: KnownDiverPanelProps) {
  const t = useTranslations("booking");
  return (
    <div className="rounded-inset border border-border bg-surface-sunken/60 px-4 py-3 text-sm">
      <input type="hidden" name="handoff" value={handoff} />
      <p className="font-semibold">{t("knownDiver.heading", { name })}</p>
      {lines.length > 0 ? (
        <ul className="mt-1 space-y-0.5 text-muted">
          {lines.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
      ) : null}
      {signOut ? (
        <p className="mt-2 text-muted">
          {t.rich("knownDiver.notYouSignedIn", {
            name,
            button: (chunks) => (
              <button
                type="submit"
                formAction={signOut}
                formNoValidate
                className="font-medium text-primary hover:underline"
              >
                {chunks}
              </button>
            ),
          })}
        </p>
      ) : (
        <p className="mt-2 text-muted">
          {t.rich("knownDiver.notYou", {
            name,
            a: (chunks) => (
              <Link href={blankHref} className="font-medium text-primary hover:underline">
                {chunks}
              </Link>
            ),
          })}
        </p>
      )}
    </div>
  );
}
