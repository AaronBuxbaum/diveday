import Link from "next/link";
import { ShopNotice } from "@/components/ui/outcome";
import { openPersonClashResult } from "@/features/person-clash-result";
import { staffTranslator } from "@/i18n/staff-messages";
import { isShopDayParam } from "@/lib/calendar-date";
import { uuidParam } from "@/lib/uuid";

/** The conflicts recorded in the transaction that just changed the schedule. */
export function PersonClashNotice({
  token,
  shopId,
  tripId,
  shopSlug,
  day,
  locale,
}: {
  token?: string;
  shopId: string;
  tripId?: string;
  shopSlug: string;
  day?: string;
  locale: string;
}) {
  const id = uuidParam(tripId);
  const result = id ? openPersonClashResult(token, shopId, id) : null;
  if (!token || (result && !result.clashes.length && !result.omitted)) return null;
  const t = staffTranslator(locale);
  const messages = (result?.clashes ?? []).map(({ personName, otherTitle }) =>
    t("schedule.dayBoard.standingClash", { name: personName, departure: otherTitle }),
  );
  const href = id
    ? `/shop/${shopSlug}/trips/${id}?view=details&clashes=1`
    : `/shop/${shopSlug}/schedule/board?view=day${day && isShopDayParam(day) ? `&day=${day}` : ""}`;
  return (
    <ShopNotice tone="warning" role="alert" persistent className="mb-6">
      <div className="space-y-1">
        {messages.length ? <p className="whitespace-pre-line">{messages.join("\n")}</p> : null}
        {!result ? (
          <p>
            <Link href={href}>{t("schedule.dayBoard.clashResultUnavailable")}</Link>
          </p>
        ) : result.omitted ? (
          <p>
            <Link href={href}>{t("schedule.dayBoard.moreClashes", { count: result.omitted })}</Link>
          </p>
        ) : null}
      </div>
    </ShopNotice>
  );
}
