import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";
import { EntryDone } from "@/components/account/EntryShell";
import { BrandStyle } from "@/components/BrandStyle";
import { SubmitButton } from "@/components/SubmitButton";
import { ThreadShell } from "@/components/thread/ThreadShell";
import { buttonClass } from "@/components/ui/button";
import { SectionCard } from "@/components/ui/card";
import { controlClass, Field, FieldGrid, FormStatus } from "@/components/ui/form";
import { getDb } from "@/db/client";
import { verifyShelfToken } from "@/db/person-shelf-tokens";
import {
  getShelfPageData,
  type ShelfCertification,
  type ShelfPageData,
  type ShelfWaiver,
} from "@/db/shelf";
import { type DiverTranslator, diverTranslator } from "@/i18n/messages";
import { DIVER_CERT_LEVEL_KEYS, NEXT_DIVE_REASON_KEYS } from "@/i18n/next-dive-labels";
import { DIVER_CERTIFICATION_AGENCY_KEYS } from "@/i18n/readiness-labels";
import { requestLocale, requestTranslator } from "@/i18n/request";
import { nowDate } from "@/lib/clock";
import { formatRelativeDay, formatShortDate, formatTime, formatWeekday } from "@/lib/format";
import { RENTAL_FIT_TEXT_LIMITS } from "@/lib/rentals";
import { RememberShelf } from "./_components/RememberShelf";
import {
  forgetShelfAction,
  openSameBoatAction,
  openThreadAction,
  rememberShelfAction,
  saveShelfEmergencyContactAction,
  saveShelfSizesAction,
} from "./actions";

/**
 * **The diver's shelf** — one page, in the shop's face, that answers the three
 * questions a returning diver actually has: when am I next out, what did I see
 * last time, and what do you already have for me.
 *
 * It is the first bearer surface anchored to a **person** rather than to a
 * booking (`person_shelf_tokens`), which is what lets it outlive every seat.
 * Everything it may show is decided in `src/db/shelf.ts`, not here: no medical
 * answer, no other diver, no price. This file renders what that reader returns
 * and can render nothing else.
 *
 * **The top rows are the reason to come back**, in that order — the departure
 * the diver holds, the same boat next time, and the crew's own "next time" from
 * the day just dived. Under them the days behind, then the file, then the two
 * quiet lines: what is never here, and how to take the greeting off a phone.
 *
 * `noindex`, no `og:url`, no structured data: the URL *is* the capability
 * (docs/engineering/capability-telemetry-runbook.md).
 */

export async function generateMetadata(): Promise<Metadata> {
  const t = diverTranslator(await requestLocale());
  return { title: t("shelf.metaTitle"), robots: { index: false, follow: false } };
}

// `instant = true`: this route has a real static shell. Every request-scoped
// read below sits inside this segment's `loading.tsx` boundary, so the frame
// paints without waiting on the request and the data streams into it — and
// `next build` fails if that ever stops being true.
// See ADR 20260804-instant-navigation.
export const instant = true;

export default async function DiverShelfPage({
  params,
  searchParams,
}: {
  params: Promise<{ token: string }>;
  searchParams: Promise<{ saved?: string; error?: string; forgot?: string }>;
}) {
  await connection();
  const { token } = await params;
  const { saved, error, forgot } = await searchParams;

  const db = await getDb();
  const capability = await verifyShelfToken(db, { token });
  // **One dead-end for every refusal.** Unknown, expired, revoked, or naming a
  // record that is gone: a bearer never learns which, and there is no self-serve
  // rescue because the shop is the only party that can mint another.
  if (!capability) {
    const anonT = diverTranslator(await requestLocale());
    return (
      <EntryDone
        glyph="expired"
        title={anonT("shelf.unavailableHeading")}
        text={anonT("shelf.unavailableBody")}
      />
    );
  }

  const now = nowDate();
  const data = await getShelfPageData(db, {
    shopId: capability.shopId,
    personId: capability.personId,
    now,
  });
  if (!data) {
    const anonT = diverTranslator(await requestLocale());
    return (
      <EntryDone
        glyph="expired"
        title={anonT("shelf.unavailableHeading")}
        text={anonT("shelf.unavailableBody")}
      />
    );
  }

  const { locale, t } = await requestTranslator(data.shop.defaultLocale);

  return (
    <>
      <BrandStyle brandColor={data.shop.brandColor} brandDisplayFont={data.shop.brandDisplayFont} />
      {/* Only a plain open remembers the phone. The saves and the forget
          come back to this page through a redirect carrying a one-shot param,
          and that render mounts this component afresh — so without the gate a
          saved size counted as a second open, and "Forget this phone" was
          undone by the very render that said "Forgotten." */}
      {saved || error || forgot ? null : (
        <RememberShelf remember={rememberShelfAction.bind(null, token)} />
      )}
      <ThreadShell shopName={data.shop.name} title={t("shelf.title")}>
        <div className="space-y-10">
          <ReasonsToComeBack data={data} t={t} locale={locale} now={now} token={token} />
          <Dives data={data} t={t} locale={locale} />
          <TheFile data={data} t={t} locale={locale} token={token} saved={saved} error={error} />
          {/* **The one sentence about what is not here.** It earns its place by
              the definition the surfaces rule sets: a reader opening a link to
              "your file" cannot see the absence of the medical questionnaire,
              and it is the first thing they wonder about. */}
          <p className="text-sm text-muted">{t("shelf.never")}</p>
          <Forget data={data} t={t} token={token} forgot={forgot === "1"} />
        </div>
      </ThreadShell>
    </>
  );
}

/** The three rows at the top, each rendering nothing when it has nothing. */
function ReasonsToComeBack({
  data,
  t,
  locale,
  now,
  token,
}: {
  data: ShelfPageData;
  t: DiverTranslator;
  locale: string;
  now: Date;
  token: string;
}) {
  const zone = data.shop.timezone;
  if (!data.next && !data.sameBoat && !data.nextTime) return null;
  return (
    <div className="space-y-4">
      {data.next ? (
        <SectionCard title={t("shelf.nextHeading")}>
          <p className="mt-1 text-lg font-medium">{data.next.title}</p>
          <p className="text-sm text-muted">
            {`${formatRelativeDay(data.next.startsAt, now, locale, zone)} · ${formatTime(data.next.startsAt, locale, zone)}`}
          </p>
          <form action={openThreadAction.bind(null, token, data.next.bookingId)} className="mt-4">
            {/* The page's one primary: the seat this diver holds is the reason
                they came. Everything else here is secondary or quieter. */}
            <SubmitButton pendingLabel={t("shelf.nextOpen")} className={buttonClass()}>
              {t("shelf.nextOpen")}
            </SubmitButton>
          </form>
        </SectionCard>
      ) : null}

      {data.sameBoat ? (
        <SectionCard
          title={t(
            data.sameBoat.because === "boat" ? "shelf.sameBoatBoat" : "shelf.sameBoatSeries",
            {
              weekday: formatWeekday(data.sameBoat.startsAt, locale, zone),
            },
          )}
        >
          <p className="mt-1 text-lg font-medium">{data.sameBoat.title}</p>
          <p className="text-sm text-muted">
            {`${formatShortDate(data.sameBoat.startsAt, locale, zone)} · ${formatTime(data.sameBoat.startsAt, locale, zone)}`}
          </p>
          <form
            action={openSameBoatAction.bind(null, token, data.sameBoat.tripId)}
            className="mt-4"
          >
            <SubmitButton
              pendingLabel={t("shelf.sameBoatOpen")}
              className={buttonClass({ variant: "secondary" })}
            >
              {t("shelf.sameBoatOpen")}
            </SubmitButton>
          </form>
        </SectionCard>
      ) : null}

      {/* The crew's own "next time", ranked from the day just dived by the same
          `pickNextDive` the recap uses — one departure and one reason, never a
          score and never a list. */}
      {data.nextTime ? (
        <SectionCard title={t("shelf.nextTimeHeading")}>
          <p className="mt-1 text-lg font-medium">{data.nextTime.title}</p>
          <p className="text-sm text-muted">
            {t(NEXT_DIVE_REASON_KEYS[data.nextTime.reason], {
              site: data.nextTime.reasonSite ?? "",
              course: data.nextTime.reasonCourse ?? "",
              lens: data.nextTime.reasonLens ?? "",
            })}
          </p>
          <p className="text-sm text-muted">
            {formatRelativeDay(data.nextTime.startsAt, now, locale, zone)}
          </p>
        </SectionCard>
      ) : null}
    </div>
  );
}

/**
 * The days behind, as a rail of fronts. Each is a door to that day's recap;
 * the rail scrolls sideways on a phone rather than growing the page, and is
 * bounded in the reader (`SHELF_DIVE_LIMIT`) rather than by a filter here.
 */
function Dives({ data, t, locale }: { data: ShelfPageData; t: DiverTranslator; locale: string }) {
  if (data.dives.length === 0) return null;
  const zone = data.shop.timezone;
  return (
    <section aria-label={t("shelf.divesHeading", { shopName: data.shop.name })}>
      <h2 className="text-base font-semibold">
        {t("shelf.divesHeading", { shopName: data.shop.name })}
      </h2>
      <p className="mt-1 text-sm text-muted">{t("shelf.divesCount", { count: data.diveCount })}</p>
      <ul className="mt-4 flex snap-x gap-3 overflow-x-auto pb-2">
        {data.dives.map((dive) => (
          <li key={dive.bookingId} className="w-56 shrink-0 snap-start">
            <Link
              href={dive.recapPath ?? "#"}
              className="flex h-full flex-col rounded-lg border border-border bg-surface p-4 transition-colors hover:bg-surface-sunken"
            >
              <span className="text-sm text-muted tabular-nums">
                {formatShortDate(dive.startsAt, locale, zone)}
              </span>
              <span className="mt-1 text-base font-semibold">{dive.title}</span>
              {dive.siteNames.length > 0 ? (
                <span className="mt-1 text-sm text-muted">{dive.siteNames.join(" · ")}</span>
              ) : null}
              <span className="mt-3 text-sm font-medium text-primary">{t("shelf.divesRecap")}</span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** The card, the release, the sizes, the team, the contact. */
function TheFile({
  data,
  t,
  locale,
  token,
  saved,
  error,
}: {
  data: ShelfPageData;
  t: DiverTranslator;
  locale: string;
  token: string;
  saved?: string;
  error?: string;
}) {
  const zone = data.shop.timezone;
  const { file } = data;
  const day = (value: Date) => formatShortDate(value, locale, zone);
  return (
    <SectionCard title={t("shelf.fileHeading")}>
      <dl className="mt-2 divide-y divide-border">
        <Row label={t("shelf.certification")}>{certificationLines(file.certification, t, day)}</Row>
        <Row label={t("shelf.waiver")}>{waiverLine(file.waiver, t, day, data.shop.name)}</Row>
        {file.buddyTeam ? (
          <Row label={t("shelf.buddyTeam")}>
            {t("shelf.buddyTeamSize", {
              count: file.buddyTeam.size,
              date: day(file.buddyTeam.startsAt),
            })}
          </Row>
        ) : null}
      </dl>

      <form action={saveShelfSizesAction.bind(null, token)} className="mt-6">
        <h3 className="text-base font-semibold">{t("shelf.sizes")}</h3>
        <FieldGrid columns={2} className="mt-3">
          <Field label={t("shelf.sizeBcd")} htmlFor="shelf-bcd">
            <input
              id="shelf-bcd"
              name="bcdSize"
              defaultValue={file.sizes.bcdSize ?? ""}
              maxLength={RENTAL_FIT_TEXT_LIMITS.size}
              className={controlClass}
            />
          </Field>
          <Field label={t("shelf.sizeWetsuit")} htmlFor="shelf-wetsuit">
            <input
              id="shelf-wetsuit"
              name="wetsuitSize"
              defaultValue={file.sizes.wetsuitSize ?? ""}
              maxLength={RENTAL_FIT_TEXT_LIMITS.size}
              className={controlClass}
            />
          </Field>
          <Field label={t("shelf.sizeBoots")} htmlFor="shelf-boots">
            <input
              id="shelf-boots"
              name="bootSize"
              defaultValue={file.sizes.bootSize ?? ""}
              maxLength={RENTAL_FIT_TEXT_LIMITS.size}
              className={controlClass}
            />
          </Field>
          <Field label={t("shelf.sizeFins")} htmlFor="shelf-fins">
            <input
              id="shelf-fins"
              name="finSize"
              defaultValue={file.sizes.finSize ?? ""}
              maxLength={RENTAL_FIT_TEXT_LIMITS.size}
              className={controlClass}
            />
          </Field>
        </FieldGrid>
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <SubmitButton
            pendingLabel={t("shelf.sizesSave")}
            className={buttonClass({ variant: "secondary" })}
          >
            {t("shelf.sizesSave")}
          </SubmitButton>
          {saved === "sizes" ? (
            <FormStatus tone="success">{t("shelf.sizesSaved")}</FormStatus>
          ) : null}
          {error === "sizes" ? <FormStatus>{t("shelf.sizesRefused")}</FormStatus> : null}
        </div>
      </form>

      <form action={saveShelfEmergencyContactAction.bind(null, token)} className="mt-8">
        <h3 className="text-base font-semibold">{t("shelf.emergencyContact")}</h3>
        {/* The standing fact first, then the door: a diver who already has one
            on file is being told so, not asked again. Never the name or the
            number — those are on the shop's own record, and this page is
            reachable by whoever holds the phone. */}
        <p className="mt-1 text-sm text-muted">
          {t(
            file.emergencyContactOnFile
              ? "shelf.emergencyContactOnFile"
              : "shelf.emergencyContactNone",
          )}
        </p>
        <FieldGrid columns={2} className="mt-3">
          <Field label={t("shelf.emergencyContactName")} htmlFor="shelf-contact-name">
            <input
              id="shelf-contact-name"
              name="emergencyContactName"
              maxLength={120}
              autoComplete="off"
              className={controlClass}
            />
          </Field>
          <Field label={t("shelf.emergencyContactPhone")} htmlFor="shelf-contact-phone">
            <input
              id="shelf-contact-phone"
              name="emergencyContactPhone"
              type="tel"
              maxLength={40}
              autoComplete="off"
              className={controlClass}
            />
          </Field>
        </FieldGrid>
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <SubmitButton
            pendingLabel={t("shelf.emergencyContactSave")}
            className={buttonClass({ variant: "secondary" })}
          >
            {t("shelf.emergencyContactSave")}
          </SubmitButton>
          {saved === "contact" ? (
            <FormStatus tone="success">{t("shelf.emergencyContactSaved")}</FormStatus>
          ) : null}
          {error === "contact" ? (
            <FormStatus>{t("shelf.emergencyContactRefused")}</FormStatus>
          ) : null}
          {/* The waiver's own sentence: the same two boxes, the same fix. */}
          {error === "contact-pair" ? (
            <FormStatus>{t("waiver.errorContactPair")}</FormStatus>
          ) : null}
        </div>
      </form>
    </SectionCard>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex min-h-11 flex-wrap items-baseline justify-between gap-x-4 gap-y-1 py-3">
      <dt className="text-base font-medium">{label}</dt>
      <dd className="text-sm text-muted">{children}</dd>
    </div>
  );
}

function certificationLines(
  card: ShelfCertification,
  t: DiverTranslator,
  day: (value: Date) => string,
): string {
  if (card.state === "none") return t("shelf.certificationNone");
  const named = `${t(DIVER_CERT_LEVEL_KEYS[card.level])} · ${t(DIVER_CERTIFICATION_AGENCY_KEYS[card.agency])}`;
  if (card.state === "on_file") return `${named} · ${t("shelf.certificationUnchecked")}`;
  const checked = card.verifiedBy
    ? t("shelf.certificationChecked", { name: card.verifiedBy, date: day(card.verifiedAt) })
    : t("shelf.certificationCheckedNoName", { date: day(card.verifiedAt) });
  return `${named} · ${checked}`;
}

function waiverLine(
  waiver: ShelfWaiver,
  t: DiverTranslator,
  day: (value: Date) => string,
  shopName: string,
): string {
  if (waiver.state === "signed") {
    return t("shelf.waiverSigned", {
      signedAt: day(waiver.signedAt),
      expiresAt: day(waiver.expiresAt),
    });
  }
  if (waiver.state === "with_the_shop") return t("shelf.waiverWithTheShop", { shopName });
  return t("shelf.waiverNeedsSigning");
}

/** Takes the greeting off this phone, and does nothing else. */
function Forget({
  data,
  t,
  token,
  forgot,
}: {
  data: ShelfPageData;
  t: DiverTranslator;
  token: string;
  forgot: boolean;
}) {
  return (
    <form action={forgetShelfAction.bind(null, token)} className="border-t border-border pt-6">
      <h2 className="text-base font-semibold">{t("shelf.forgetHeading")}</h2>
      <p className="mt-1 text-sm text-muted">
        {t("shelf.forgetBody", { shopName: data.shop.name })}
      </p>
      <div className="mt-4 flex flex-wrap items-center gap-3">
        <SubmitButton
          pendingLabel={t("shelf.forgetButton")}
          className={buttonClass({ variant: "secondary" })}
        >
          {t("shelf.forgetButton")}
        </SubmitButton>
        {forgot ? <FormStatus tone="success">{t("shelf.forgotten")}</FormStatus> : null}
      </div>
    </form>
  );
}
