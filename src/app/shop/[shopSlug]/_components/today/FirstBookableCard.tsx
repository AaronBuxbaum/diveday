import Link from "next/link";
import { Copyable } from "@/components/Copyable";
import { SECTION_TITLE_CLASS } from "@/components/ui/typography";

export type FirstBookableCardCopy = {
  heading: string;
  body: string;
  linkLabel: string;
  copy: string;
  copied: string;
  copyFailed: string;
  viewAsDiver: string;
};

/**
 * The moment a shop becomes bookable, said out loud. The first departure ever
 * landing on the board is the exact moment the first-run checklist — and the
 * public-schedule link it carried — disappears from Today, which used to make
 * the shop's biggest milestone read as a one-line "it's on the board" while
 * the link worth sharing silently vanished. This card replaces that notice
 * exactly once: the shareable link, a copy button, and the door to seeing the
 * page as a diver sees it. Subsequent trips get the ordinary notice; this
 * moment only happens once per shop.
 */
export function FirstBookableCard({
  scheduleUrl,
  scheduleHref,
  copy,
}: {
  /** Absolute when APP_HOST is configured; falls back to the bare path. */
  scheduleUrl: string;
  /** Always the path — what the in-app "see it" link navigates to. */
  scheduleHref: string;
  copy: FirstBookableCardCopy;
}) {
  return (
    <section
      aria-labelledby="first-bookable-heading"
      className="mb-6 rounded-2xl border border-success/30 bg-success/5 p-5 sm:p-6"
    >
      <h2 id="first-bookable-heading" className={SECTION_TITLE_CLASS}>
        {copy.heading}
      </h2>
      <p className="mt-1 text-sm text-muted">{copy.body}</p>
      <Copyable
        className="mt-4"
        value={scheduleUrl}
        label={copy.linkLabel}
        copyLabel={copy.copy}
        copiedLabel={copy.copied}
        failedLabel={copy.copyFailed}
      />
      <p className="mt-3 text-sm">
        <Link href={scheduleHref} className="font-medium text-primary hover:underline">
          {copy.viewAsDiver}
        </Link>
      </p>
    </section>
  );
}
