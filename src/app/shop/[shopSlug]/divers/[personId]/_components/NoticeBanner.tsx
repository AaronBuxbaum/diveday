import Link from "next/link";
import { ShopNotice } from "@/components/ShopPageHeader";
import { FormStatus } from "@/components/ui/form";
import { staffTranslator } from "@/i18n/staff-messages";
import { noticeRole } from "@/lib/staff-notices";
import type { DiverNotice } from "./record-notices";

export type { DiverNotice } from "./record-notices";

/**
 * One section's own outcome, in that section's action row.
 *
 * A thin wrapper over the shared `FormStatus` so every section on this page
 * spells the same one-liner, and so the one notice that carries a link
 * (`payment-not-connected`) keeps it wherever it lands. Renders nothing at
 * rest, so a form's action row keeps its exact resting layout.
 */
export function DiverFormStatus({
  status,
  shopSlug,
  locale,
  className = "",
}: {
  status?: DiverNotice;
  /** Only needed by the one notice that carries a link. */
  shopSlug?: string;
  locale?: string;
  className?: string;
}) {
  if (!status || status.silent) return null;
  return (
    <FormStatus tone={status.tone} className={className}>
      {status.text}
      {status.link && shopSlug ? (
        <>
          {" "}
          <Link href={status.link.href(shopSlug)} className="underline underline-offset-2">
            {staffTranslator(locale)(status.link.key)}
          </Link>
        </>
      ) : null}
    </FormStatus>
  );
}

/**
 * The page-level banner — now only for what has no form to sit beside: a
 * refusal that bounced the staffer here from somewhere else, the generic
 * `invalid` fallback with no `?form=` on it, and any notice whose section this
 * staffer's role means the page never rendered (a refund refusal for someone
 * who cannot see the refund control at all).
 */
export function NoticeBanner({
  notice,
  shopSlug,
  locale,
}: {
  notice?: DiverNotice;
  shopSlug?: string;
  locale?: string;
}) {
  if (!notice || notice.silent) return null;
  return (
    <ShopNotice tone={notice.tone} role={noticeRole(notice.tone)} className="mt-6">
      {notice.text}
      {notice.link && shopSlug ? (
        <>
          {" "}
          <Link href={notice.link.href(shopSlug)} className="underline underline-offset-2">
            {staffTranslator(locale)(notice.link.key)}
          </Link>
        </>
      ) : null}
    </ShopNotice>
  );
}
