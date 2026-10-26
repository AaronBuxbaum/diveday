import Link from "next/link";
import { EmptyState } from "@/components/EmptyState";
import { Pager, staffPagerWords } from "@/components/Pager";
import { DiveDayIcon } from "@/components/StaffDestinationIcon";
import { buttonClass } from "@/components/ui/button";
import { type FilterChip, FilterChips } from "@/components/ui/FilterChips";
import { SearchField } from "@/components/ui/form";
import { GroupLabel } from "@/components/ui/group-label";
import { QueryForm } from "@/components/ui/QueryForm";
import type { SignedRecordView, SignedWaiverEntry, WaiverIntegrityAuditPage } from "@/db/waivers";
import type { StaffTranslator } from "@/i18n/staff-messages";
import { shopPath } from "@/lib/staff-notices";
import { SignatureLog } from "./SignatureLog";

/**
 * **The signed records: find one in a line, then read the log.** The diver's
 * name, email or phone, and two views a reviewer goes looking for: records
 * whose seal cannot be checked, and medical follow-ups (third UX review, item
 * 31). The search, the view and the `?record=` pin travel with every page turn
 * and chip, so a narrowed log never widens behind the reader's back.
 */
export function SignedRecordsSection({
  auditPage,
  pinned,
  query,
  view,
  record,
  shopSlug,
  locale,
  timezone,
  t,
}: {
  auditPage: WaiverIntegrityAuditPage;
  /** The `?record=` record, resolved even when it falls on another page. */
  pinned: SignedWaiverEntry | null;
  query: string;
  view: SignedRecordView | undefined;
  /** The raw `?record=` id, carried on every link. */
  record: string | undefined;
  shopSlug: string;
  locale: string;
  timezone: string;
  t: StaffTranslator;
}) {
  const narrowed = Boolean(query || view);
  // The pin renders inside its own day group below, so the page's own rows
  // must not render it a second time. `SignatureRow` puts
  // `id="waiver-record-<id>"` on its `<li>`, and a pinned record that also
  // falls on the visible page produced **two elements with the same DOM id** —
  // invalid HTML, two hit targets for one anchor, and the same evidence row
  // shown twice on one screen.
  //
  // It only ever surfaced as a test failure because it depends on where the
  // record lands: the list orders by `signedAt desc, id desc`, and `id` is a
  // random UUID, so a record sitting on a page boundary among rows that share
  // a timestamp crosses it or not depending on the UUIDs a given seed drew.
  //
  // Only the rendered rows are filtered. `auditPage`'s total and page count
  // describe the whole log and stay untouched — the record has not gone
  // anywhere, it is one day group further up.
  const entries = auditPage.entries.filter((entry) => entry.id !== pinned?.id);
  const base = shopPath(shopSlug, "waivers");
  // The `?record=` pin travels with the page rather than being dropped the
  // moment a reviewer turns one, and the anchor keeps a page turn landing on
  // the log instead of back at the release editor above it.
  // The search and the view travel with every page turn and chip, so a
  // narrowed log never widens behind the reader's back.
  const logHref = ({
    target = 1,
    nextView = view,
    keepQuery = true,
  }: {
    target?: number;
    /** Omit to inherit the current view; null clears it. */
    nextView?: SignedRecordView | null;
    keepQuery?: boolean;
  }) => {
    const search = new URLSearchParams();
    if (keepQuery && query) search.set("q", query);
    if (nextView) search.set("view", nextView);
    if (target > 1) search.set("page", String(target));
    if (record) search.set("record", record);
    const encoded = search.toString();
    return `${encoded ? `${base}?${encoded}` : base}#signed-records-heading`;
  };
  const pageHref = (target: number) => logHref({ target });
  const viewChips: FilterChip[] = [
    {
      key: "all",
      label: t("waiversStaff.signatures.views.all"),
      href: logHref({ nextView: null }),
      active: !view,
    },
    {
      key: "unchecked",
      label: t("waiversStaff.signatures.views.unchecked"),
      href: logHref({ nextView: "unchecked" }),
      active: view === "unchecked",
    },
    {
      key: "medical",
      label: t("waiversStaff.signatures.views.medical"),
      href: logHref({ nextView: "medical" }),
      active: view === "medical",
    },
  ];

  return (
    <section className="mt-6" aria-labelledby="signed-records-heading">
      <GroupLabel as="h2" id="signed-records-heading" className="scroll-mt-24">
        {t("waiversStaff.signatures.heading")}
      </GroupLabel>
      {auditPage.total > 0 || narrowed ? (
        <div className="mt-4 flex flex-col gap-3">
          <QueryForm
            aria-label={t("waiversStaff.signatures.searchLabel")}
            keep={{ view }}
            action={`${base}#signed-records-heading`}
            className="flex items-center gap-2"
          >
            <SearchField
              id="signed-record-search"
              name="q"
              label={t("waiversStaff.signatures.searchLabel")}
              defaultValue={query}
              placeholder={t("waiversStaff.signatures.searchPlaceholder")}
              className="w-full min-w-0 sm:w-80"
            />
            {query ? (
              <Link
                href={logHref({ keepQuery: false })}
                scroll={false}
                aria-label={t("waiversStaff.signatures.searchClear")}
                title={t("waiversStaff.signatures.searchClear")}
                className={buttonClass({ variant: "ghost", size: "icon" })}
              >
                <DiveDayIcon name="close" className="size-4" />
              </Link>
            ) : null}
          </QueryForm>
          <FilterChips label={t("waiversStaff.signatures.views.label")} chips={viewChips} />
        </div>
      ) : null}
      {auditPage.total === 0 ? (
        <EmptyState
          title={
            narrowed
              ? t("waiversStaff.signatures.noMatch")
              : t("waiversStaff.signatures.noSignedRecords")
          }
          className="mt-4"
        />
      ) : (
        <>
          <div className="mt-4">
            <SignatureLog
              entries={entries}
              pinned={pinned}
              shopSlug={shopSlug}
              locale={locale}
              timezone={timezone}
              t={t}
            />
          </div>
          <Pager
            page={auditPage.page}
            pageCount={auditPage.pageCount}
            href={pageHref}
            total={t("waiversStaff.signatures.pagination.total", { count: auditPage.total })}
            words={staffPagerWords(t)}
          />
        </>
      )}
    </section>
  );
}
