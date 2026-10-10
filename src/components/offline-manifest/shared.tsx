import type { ReactNode } from "react";
import { OFFLINE_NOTICE_CLASS } from "@/components/offline-notice";
import { Badge } from "@/components/ui/badge";
import { buttonClass } from "@/components/ui/button";
import { textareaClassFor } from "@/components/ui/form";
import { StatusMark, type StatusMarkVariant } from "@/components/ui/StatusMark";
import { matchLocale } from "@/i18n/negotiate";
import {
  type OfflineManifestTranslator,
  offlineManifestTranslator,
} from "@/i18n/offline-manifest-messages";
import { DEFAULT_DIVER_LOCALE, type DiverLocale } from "@/i18n/settings";
import { cachedFormatter, cachedListFormat } from "@/lib/intl-cache";
import { ROLL_CALL_NOTE_MAX } from "@/lib/manifests";
import type { DiscardedOfflineRecord } from "@/lib/offline-manifest-store";
import {
  type OfflineRollCallEvent,
  type OfflineRollCallResult,
  offlineManifestAge,
} from "@/lib/offline-manifests";

/**
 * The device's own language. This is the one surface that cannot use
 * `requestLocale` (src/i18n/request.ts): it renders from an encrypted snapshot
 * in IndexedDB with the radio off, so there is no request and no
 * `Accept-Language` header to negotiate from. Both call sites run after the
 * snapshot has loaded from storage, so `navigator` is always defined by then —
 * the guard is for safety, not for a real server render.
 */
/**
 * The dock target, built from the same wrapper the live manifest's roll-call
 * buttons use — `w-full` on a phone, auto-width beside the row from `sm` up.
 *
 * This was a copied literal, and the comment justifying the copy was wrong:
 * it said the constant lived under `src/app`, which `src/components` may not
 * import (`pnpm check:architecture`) — true of that constant, but the thing it
 * was a copy *of* is `buttonClass`, which lives in `src/components/ui/` and
 * was already imported into this file. The two literals had drifted apart on
 * padding, press scale and disabled opacity, and neither carried the
 * `cursor-pointer` that Tailwind v4's Preflight removed from `<button>`.
 */
export const OFFLINE_BOAT_TARGET_CLASS = buttonClass({
  variant: "bare",
  size: "boat",
  busy: true,
  className: "w-full sm:w-auto",
});

/**
 * A buddy team's names as one list, **each name held whole**: a no-break space
 * inside every name, so a line wraps between "Diego Alvarez" and "June Park"
 * and never inside either. The Spanish crew line split "Diego / Alvarez" at a
 * line end, which reads as two people.
 *
 * **Whole is a preference, not a promise.** A name longer than its column
 * ("María de los Ángeles Fernández Gutiérrez", 41 characters, at glare's 16px
 * on a phone) cannot be held whole, and the diver list and the crew box are
 * both `overflow-hidden`: it ran past its column and the box clipped the
 * surname off. So every place these names are set breaks an overlong name
 * anywhere as a last resort (`BUDDY_NAMES_WRAP`), which an ordinary name
 * never reaches.
 */
export function buddyNamesList(locale: string, names: readonly string[]): string {
  return cachedListFormat(locale, { type: "conjunction" }).format(
    names.map((name) => name.replace(/ /g, "\u00a0")),
  );
}

/** Breaks a name too long for its column, last, rather than letting it be clipped. */
export const BUDDY_NAMES_WRAP = "wrap-anywhere";

/**
 * One diver's roll-call row id, minted here and nowhere else: this is both what
 * the row carries and what the missing-divers grid is handed to jump to.
 *
 * Two literals one screen apart is how that grid spent its life scrolling to
 * `diver-row-<bookingId>` — the **live** manifest's id — while the rows on this
 * page answered to `offline-roll-call-<bookingId>`, so every tap at the rail did
 * nothing at all (#1675). One function is what makes the pair undriftable; the
 * grid holds no prefix of its own to be wrong about.
 */
export function offlineRollCallRowId(bookingId: string): string {
  return `offline-roll-call-${bookingId}`;
}

/**
 * The summary line of a row's disclosure on the offline roll call — the
 * "Contact & gear" facts and the exception (#1840) alike, so the two
 * disclosures under one name are one shape: a 44px line in muted ink with its
 * own caret, the live manifest's "one tap away" tier.
 */
export const OFFLINE_DISCLOSURE_SUMMARY_CLASS =
  "group/summary -mx-2 flex min-h-11 w-fit cursor-pointer list-none items-center gap-2 rounded-lg px-2 text-base font-medium text-muted select-none transition-colors hover:bg-surface-sunken/70 hover:text-primary focus-visible:focus-ring-inset [&::-webkit-details-marker]:hidden";

export function OfflineStatusLabel({
  variant,
  children,
}: {
  variant: StatusMarkVariant;
  children: ReactNode;
}) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <StatusMark variant={variant} />
      <span>{children}</span>
    </span>
  );
}

export function deviceLocale(): string | undefined {
  return typeof navigator === "undefined" ? undefined : navigator.language;
}

/**
 * "16 minutes ago" / "4 hours ago", in the device's own language. `numeric:
 * "always"` rather than `"auto"` on purpose: "auto" would render this as
 * "last hour", and a copy whose age is the reason not to trust it has to say a
 * number. Nothing calls this on a copy young enough to floor to zero — only a
 * row past the 15-minute "current" threshold shows an age at all.
 */
export function relativeAge(savedAt: Date): string {
  const { unit, value } = offlineManifestAge(savedAt);
  return cachedFormatter("rel", Intl.RelativeTimeFormat, deviceLocale(), {
    numeric: "always",
  }).format(-value, unit);
}

/**
 * The staff bundle (src/i18n/staff-messages.ts) is documented as
 * server-side-only for every other staff surface — its words normally reach a
 * Client Component as a `copy` prop built by a Server Component parent, never
 * as a function crossing that boundary. This view has no such parent request:
 * it renders fully offline from an IndexedDB snapshot (see `deviceLocale`
 * above), so there is no per-request `Accept-Language` header to negotiate
 * from server-side. `offlineManifestTranslator` itself has no server-only
 * dependency — it is a plain function over three JSON namespaces — so it is
 * called directly here, entirely within this client module, rather than
 * crossing the RSC boundary (which is the thing that's actually unsafe).
 * `matchLocale` gives it the same fuzzy `es-MX` → `es-ES` matching every other
 * surface gets, instead of the exact-tag-only fallback it uses on its own.
 *
 * **Three namespaces, not the whole staff bundle** (issue #1353). This is a
 * client module, so whatever it imports a diver downloads; `staffTranslator`
 * pulled 31 namespaces in two locales to render three, and made this the
 * heaviest route in the app. See `@/i18n/offline-manifest-messages`.
 */
export function translatorForThisDevice() {
  const requested = deviceLocale();
  const resolved: DiverLocale = requested
    ? (matchLocale([{ tag: requested, quality: 1 }]) ?? DEFAULT_DIVER_LOCALE)
    : DEFAULT_DIVER_LOCALE;
  return { t: offlineManifestTranslator(resolved), locale: resolved };
}

/**
 * What one tap queues: a status, plus — on a retraction — the statement it takes
 * back.
 *
 * The two travel together because they are one decision. A `cleared` that does
 * not name its target is a blind newest-wins write against a row that may be
 * "did this diver come back from the dive", and the pair being separable is how
 * one of the four controls below would end up sending the retraction without it.
 */
export type OfflineStatement = Pick<OfflineRollCallEvent, "status" | "retractsClientEventId">;

/**
 * What re-tapping a control that already carries its own state should queue: the
 * **retraction**, naming the event being undone, or a fresh statement.
 *
 * One function for all four controls (diver and crew × aboard and not-aboard),
 * so the rule cannot hold on three of them and lapse on the fourth. `active` is
 * "this control is the one showing the current reading" — the caller's own
 * question, since the aboard control asks about `state === "boarded"` and the
 * exception control asks `rollCallRowState`'s `recordedNotBoarded`.
 *
 * Two conditions, and both are load-bearing:
 *
 * - `local` — the reading came from an event **this device queued** (ADR
 *   20260815-offline-can-unsay-a-missing-diver). A snapshot reading is somebody
 *   else's statement, and the row says where to undo it.
 * - `clientEventId` — the id the server compares against before applying the
 *   retraction (ADR 20260815-an-offline-retraction-names-its-target). The two
 *   are dropped together when a retraction of this reading has already been
 *   refused, so a row whose undo cannot succeed stops offering one.
 *
 * With neither, the tap falls through to `otherwise` — a **fresh statement**,
 * not a retraction, and that is the right reading of the state it happens in: a
 * row this device did not record, or one the server has told us belongs to
 * somebody else now. Re-stating "not back aboard" there re-raises the same
 * alarm and holds the count open; re-stating "boarded" is a new sighting by
 * somebody who can see the person. Never a bare `cleared`, which the server
 * would apply blind.
 */
/**
 * The box a crew member writes "surfaced 200 m north, picked up by the rescue boat"
 * into, on the copy they are actually holding when a diver does not come back
 * (ADR 20260828-a-missing-diver-gets-a-sentence).
 *
 * **After a dive only**, matching the live manifest and the server rule: at the
 * dock `not_boarded` means "never left", which has never needed a sentence. It
 * sits beneath the row's controls rather than inside the cluster so it claims a
 * full line at every width, and it is `print:hidden` like every other control
 * on this surface — what prints is the departure log, not this viewer.
 */
export function OfflineRollCallNote({
  subjectId,
  label,
  value,
  onChange,
}: {
  subjectId: string;
  label: string;
  value: string;
  onChange: (next: string) => void;
}) {
  return (
    <p className="w-full print:hidden">
      <label htmlFor={`offline-roll-call-note-${subjectId}`} className="sr-only">
        {label}
      </label>
      <textarea
        id={`offline-roll-call-note-${subjectId}`}
        rows={2}
        maxLength={ROLL_CALL_NOTE_MAX}
        placeholder={label}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className={`${textareaClassFor(2)} text-base`}
      />
    </p>
  );
}

export function reTap(
  state: OfflineRollCallResult | undefined,
  active: boolean,
  otherwise: "boarded" | "not_boarded",
): OfflineStatement {
  return active && state?.local && state.clientEventId
    ? { status: "cleared", retractsClientEventId: state.clientEventId }
    : { status: otherwise };
}

/**
 * What this device threw away at the retention ceiling
 * (`OFFLINE_MANIFEST_PENDING_GRACE_MS`, security review 2026-08-06 F3): roll
 * call a crew member recorded offline that never reached DiveDay, on a saved
 * copy too old to keep. Deleting that silently would be its own harm — it is
 * unsynced evidence of who came back from a dive — so the store writes the loss
 * down and this says it out loud.
 *
 * Rendered on every branch of the shell, not only the one that happened to
 * trigger the delete: the delete usually happens with no page open at all (the
 * service worker's push refresh, the staff layout's auto-save), so "wherever a
 * human next looks" is the only delivery that works. It carries the shop and
 * trip so the loss is actionable, and no diver, contact or booking id — the
 * notice must not re-retain the roster the discard removed.
 *
 * Danger-toned and dismissed by hand rather than on display: this is the one
 * thing on this surface that cannot be recovered by reconnecting, and a captain
 * who was ashore that day should still find it waiting.
 */
export function DiscardedRecordsNotice({
  t,
  records,
  onAcknowledge,
}: {
  t: OfflineManifestTranslator;
  records: DiscardedOfflineRecord[];
  onAcknowledge: () => void;
}) {
  if (records.length === 0) return null;
  const lostEvents = records.reduce((sum, record) => sum + record.pendingEvents, 0);
  return (
    <section role="alert" className={`mb-4 ${OFFLINE_NOTICE_CLASS} border-danger/40 bg-danger/10`}>
      <p className="font-bold text-danger">{t("shared.offlineManifest.discarded.heading")}</p>
      <p className="mt-1">{t("shared.offlineManifest.discarded.body", { count: lostEvents })}</p>
      <ul className="mt-2 space-y-1 text-sm font-semibold">
        {records.map((record) => (
          <li key={`${record.tripId}:${record.discardedAt}`}>
            {t("shared.offlineManifest.discarded.item", {
              shop: record.shopName,
              trip: record.tripTitle,
              count: record.pendingEvents,
            })}
          </li>
        ))}
      </ul>
      <button
        type="button"
        onClick={onAcknowledge}
        className={buttonClass({ variant: "secondary", size: "sm", className: "mt-3" })}
      >
        {t("shared.offlineManifest.discarded.acknowledge")}
      </button>
    </section>
  );
}

/**
 * The saved team a dock-copy row wears — names only, never a verdict. There is
 * deliberately no tone variant: this copy cannot know who came back, so it must
 * never look like it is telling you (ADR 20260804-buddy-teams).
 *
 * The neutral `Badge` for the same reason as the state word beside it: its
 * edge, an inset ring, is what shows the chip's box on the sunken awaiting row.
 */
export function OfflineBuddyTeamChip({
  t,
  locale,
  names,
}: {
  t: OfflineManifestTranslator;
  locale: string;
  names?: string[];
}) {
  if (!names || names.length === 0) return null;
  return (
    <Badge tone="neutral" className={BUDDY_NAMES_WRAP}>
      {t("shared.buddyTeam.with", { names: buddyNamesList(locale, names) })}
    </Badge>
  );
}
