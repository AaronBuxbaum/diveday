import { readBookkeeper } from "@/db/bookkeeper";
import { getDb } from "@/db/client";
import { canPersonExportShopData } from "@/db/export";
import type { StaffTranslator } from "@/i18n/staff-messages";
import { requireStaffSession } from "@/lib/session";
import { saveBookkeeperAction } from "../bookkeeper-actions";
import { BookkeeperForm } from "./BookkeeperForm";
import { bookkeeperStatusLine } from "./bookkeeper-status";

/**
 * **The bookkeeper's address, under the month's downloads** (fifth loop, item
 * 35): where the three files go on the 2nd. Read and rendered only for an
 * owner or manager (`canPersonExportShopData`), the gate the save holds.
 *
 * Under the field, one line says who stands behind the address and when
 * (security review F1), whether its inbox has confirmed yet (B1), and, when
 * whoever set it can no longer export the shop's data, that nothing is sent
 * until someone who can saves it again. When the last month's files to it
 * bounced, the line says so (issue #2798).
 */
export async function MonthEndSection({
  shopSlug,
  locale,
  timeZone,
  t,
}: {
  shopSlug: string;
  locale: string;
  timeZone: string;
  t: StaffTranslator;
}) {
  // The session's shop and person, as the save reads them.
  const { user } = await requireStaffSession();
  const db = await getDb();
  if (!(await canPersonExportShopData(db, user.shopId, user.personId))) return null;
  const bookkeeper = await readBookkeeper(db, user.shopId);
  const status = bookkeeper
    ? bookkeeperStatusLine(bookkeeper, {
        setterCanExport: await canPersonExportShopData(db, user.shopId, bookkeeper.setByPersonId),
        t,
        locale,
        timeZone,
      })
    : null;
  return (
    <section
      id="bookkeeper"
      aria-label={t("reports.bookkeeper.label")}
      className="mt-6 scroll-mt-24"
    >
      <BookkeeperForm
        action={saveBookkeeperAction.bind(null, shopSlug)}
        current={bookkeeper?.email ?? null}
        status={status}
        copy={{
          label: t("reports.bookkeeper.label"),
          description: t("reports.bookkeeper.description"),
          save: t("reports.bookkeeper.save"),
          saving: t("reports.bookkeeper.saving"),
          saved: t("reports.bookkeeper.saved"),
          cleared: t("reports.bookkeeper.cleared"),
          invalid: t("reports.bookkeeper.invalid"),
          confirmationSent: t("reports.bookkeeper.confirmationSent"),
          confirmationNotSent: t("reports.bookkeeper.confirmationNotSent"),
        }}
      />
    </section>
  );
}
