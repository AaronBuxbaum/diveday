import Image from "next/image";
import { ImageFileInput } from "@/components/ImageFileInput";
import { StoredPhoto } from "@/components/StoredPhoto";
import { SubmitButton } from "@/components/SubmitButton";
import { buttonClass } from "@/components/ui/button";
import { DisclosureCaret } from "@/components/ui/DisclosureCaret";
import { controlClass, FormStatus } from "@/components/ui/form";
import type { RecapPageData } from "@/db/recap";
import type { AfterStateProps } from "@/features/recap-after-state";
import type { fieldGuideCards } from "@/i18n/marine-life-labels";
import type { DiverMessageKey, DiverTranslator } from "@/i18n/messages";
import { cachedFormatter } from "@/lib/intl-cache";
import { capturePhoto } from "@/lib/marine-life-tiles";
import { currencySymbol, minorToMajor, type ShopCurrency } from "@/lib/money";
import { MAX_IMAGE_MB } from "@/lib/storage/limits";
import { ShareWithBoatTick } from "./ShareWithBoatTick";
import { TipAmountPicker } from "./TipAmountPicker";

/**
 * One quiet door: a hairline row that says what is behind it and opens it in
 * place. The same construction the prep state's spine uses for a step with a
 * form — a native `<details>`, so keyboard and screen-reader semantics come
 * free and a failed hydrate still leaves the form one tap away.
 */
export function Door({
  id,
  summary,
  open,
  children,
}: {
  id: string;
  summary: string;
  /** Open on arrival — there is something inside worth landing on. */
  open: boolean;
  children: React.ReactNode;
}) {
  return (
    // `data-recap-door` is the door's own hook, the same reach
    // `data-thread-step` gives the prep spine: an e2e spec has to *open* a door
    // before the form inside it is on screen, and `e2e/fixtures.ts` filters
    // every `getBy*` to visible nodes.
    <li data-recap-door={id} className="border-t border-border last:border-b">
      <details id={id} open={open} className="group/door">
        <summary className="flex min-h-14 cursor-pointer list-none items-center gap-3 py-3 select-none [&::-webkit-details-marker]:hidden">
          <span className="min-w-0 flex-1 text-base font-semibold">{summary}</span>
          <DisclosureCaret className="text-muted group-open/door:rotate-90" />
        </summary>
        <div className="pb-6">{children}</div>
      </details>
    </li>
  );
}

/**
 * The tip door. It renders at all only when the shop can take a tip right now
 * *or* there is a durable tip to report: a shop that disconnects Stripe after
 * a diver already paid must not lose the diver's own confirmation along with
 * the form.
 */
export function TipDoor({
  t,
  locale,
  shopName,
  currency,
  canTip,
  tip,
  tipPresets,
  tipParam,
  notice,
  action,
}: {
  t: DiverTranslator;
  locale: string;
  shopName: string;
  currency: ShopCurrency;
  canTip: boolean;
  tip: RecapPageData["tip"];
  tipPresets: number[];
  tipParam?: string;
  notice: { tone: "success" | "danger"; key: DiverMessageKey } | undefined;
  action: (formData: FormData) => void | Promise<void>;
}) {
  const hasReportableTip =
    tip?.status === "paid" || (tip?.status === "pending" && Boolean(tip.checkoutUrl));
  if (!canTip && !hasReportableTip) return null;

  return (
    <Door
      id="tip"
      summary={t("recap.tipCrew")}
      open={Boolean(notice) || tip?.status === "paid" || tipParam === "paid"}
    >
      {notice ? (
        <FormStatus tone={notice.tone} className="mb-3">
          {t(notice.key)}
        </FormStatus>
      ) : null}
      {tip?.status === "paid" ? (
        <p className="text-base text-muted">{t("recap.tipPaid", { shop: shopName })}</p>
      ) : tipParam === "paid" ? (
        // Stripe already redirected the diver back with `?tip=paid`, but the
        // webhook that flips `tip.status` to "paid" can lag a few seconds —
        // never re-show the payment form or a stale checkout link in that
        // window, which would read as "you still need to pay."
        <p className="text-base text-muted">{t("recap.tipConfirming")}</p>
      ) : tip?.status === "pending" && tip.checkoutUrl ? (
        <>
          <p className="text-base text-muted">{t("recap.tipAllGoes", { shop: shopName })}</p>
          <a
            href={tip.checkoutUrl}
            className={buttonClass({ variant: "secondary", className: "mt-4" })}
          >
            {t("recap.tipFinish", {
              // `minorToMajor`, never a literal 100 — a ¥3,000 tip is whole
              // yen and dividing it would offer to pay ¥30.
              amount: cachedFormatter("num", Intl.NumberFormat, locale, {
                style: "currency",
                currency: currency.toUpperCase(),
                maximumFractionDigits: 0,
              }).format(minorToMajor(tip.amountCents, currency)),
            })}
          </a>
        </>
      ) : canTip ? (
        <>
          <p className="text-base text-muted">{t("recap.tipAllGoes", { shop: shopName })}</p>
          <form action={action} className="mt-4 flex flex-col gap-3">
            <TipAmountPicker
              presets={tipPresets}
              defaultPreset={tipPresets[1]}
              currencySymbol={currencySymbol(currency, locale)}
              legend={t("recap.tipAmountLegend")}
              otherPlaceholder={t("recap.otherTipPlaceholder")}
              otherAriaLabel={t("recap.otherTipAriaLabel")}
            />
            <div>
              <SubmitButton
                pendingLabel={t("booking.headingToPayment")}
                className={buttonClass({ variant: "secondary" })}
              >
                {t("recap.tipLeave")}
              </SubmitButton>
            </div>
          </form>
        </>
      ) : null}
    </Door>
  );
}

/**
 * The photos door: what the diver already added, and one control to add more
 * up to the shop's limit. Open on arrival when it holds a photo or a notice.
 */
export function PhotoDoor({
  t,
  shopName,
  tripTitle,
  photos,
  maxPhotos,
  canShareWithBoat,
  notice,
  action,
  unshareAction,
}: {
  t: DiverTranslator;
  shopName: string;
  tripTitle: string;
  photos: AfterStateProps["photos"];
  maxPhotos: number;
  /** The share tick, from the readiness link only (`AfterStateProps.canShareWithBoat`). */
  canShareWithBoat: boolean;
  notice: { tone: "success" | "danger"; key: DiverMessageKey } | undefined;
  action: (formData: FormData) => void | Promise<void>;
  /** "Stop sharing" on the diver's own shared photo (#2806). */
  unshareAction: (formData: FormData) => void | Promise<void>;
}) {
  // Another diver's shared photos sit under their own words (H-129): the
  // diver's own and the crew's stay the grid they always were, and nothing a
  // stranger chose reads as this diver's.
  const own = photos.filter((photo) => !photo.sharedBy);
  const fromBoat = photos.filter((photo) => photo.sharedBy);
  return (
    <Door id="photos" summary={t("recap.yourPhotos")} open={Boolean(notice) || photos.length > 0}>
      <p className="text-base text-muted">{t("recap.photosBody", { shop: shopName })}</p>
      {notice ? (
        <FormStatus tone={notice.tone} className="mt-3">
          {notice.key === "recap.photoLimit" ? t(notice.key, { max: maxPhotos }) : t(notice.key)}
        </FormStatus>
      ) : null}
      {own.length ? (
        <PhotoGrid photos={own} tripTitle={tripTitle} t={t} unshareAction={unshareAction} />
      ) : null}
      {fromBoat.length ? (
        <>
          <h3 className="mt-6 text-sm font-semibold text-muted">{t("recap.fromTheBoat")}</h3>
          <PhotoGrid photos={fromBoat} tripTitle={tripTitle} t={t} />
        </>
      ) : null}
      {ownCount(photos) >= maxPhotos ? (
        <p className="mt-4 text-sm text-muted">{t("recap.photoLimitReached")}</p>
      ) : (
        <form action={action} className="mt-4">
          {/* No separate caption: the control's own button *is* "Add a
              photo", so a label above it saying the same thing was a second
              reading of one instruction. */}
          <div className="peer grid grid-cols-2 gap-3 sm:grid-cols-3">
            <ImageFileInput
              name="photo"
              required
              multiple
              shape="square"
              maxFiles={Math.max(0, maxPhotos - ownCount(photos))}
              copy={{
                choose: t("recap.addAPhoto"),
                chooseAnother: t("recap.chooseDifferentPhotos"),
                wrongTypeSuffix: t("recap.photoWrongTypeSuffix"),
                tooBigSuffix: t("recap.photoTooBigSuffix", { maxMb: MAX_IMAGE_MB }),
                tooMany: t("recap.photoTooMany", {
                  max: Math.max(0, maxPhotos - ownCount(photos)),
                }),
              }}
            />
          </div>
          {/* **One standing control, not three.** Nothing here can be used
              before a file exists, so nothing here is shown before one is
              picked: the caption and the submit were two of the door's
              three resting controls and neither could do anything
              (2026-09-17 design review).

              The reveal is **CSS, not state**, and that is the point. The
              file input carries `required`, so `:valid` is exactly "a file
              is selected" — and `ImageFileInput` clears the input when it
              refuses a file, which collapses this again with no wiring
              between the two. A `useState` here would have cost the form
              its no-JavaScript path, which is the one this page's picker is
              deliberately built to keep. `peer` is the wrapper above and
              `~ *` is how Tailwind compiles the variant, so this must stay
              its following sibling. */}
          <div className="hidden flex-col gap-3 pt-3 peer-has-[input:valid]:flex">
            <input
              type="text"
              name="caption"
              maxLength={140}
              aria-label={t("recap.captionLabel")}
              placeholder={t("recap.captionLabel")}
              className={controlClass}
            />
            {canShareWithBoat ? <ShareWithBoatTick label={t("recap.shareWithBoat")} /> : null}
            <div>
              <SubmitButton
                pendingLabel={t("recap.addingPhoto")}
                className={buttonClass({ variant: "secondary", className: "self-start" })}
              >
                {t("recap.addToMyRecap")}
              </SubmitButton>
            </div>
          </div>
        </form>
      )}
    </Door>
  );
}

/**
 * The photos that count against this page's room: everything but what another
 * diver shared with the boat, whose photos use up their own recap's room and
 * never this one's. `canAddRecapPhoto` is the gate; this only sizes the picker.
 */
function ownCount(photos: AfterStateProps["photos"]): number {
  return photos.filter((photo) => !photo.sharedBy).length;
}

/**
 * One grid of recap photos, with a caption line and, on a shared one, who
 * shared it. The diver's own shared photo carries "Stop sharing" when the grid
 * is given the action (#2806); a photo another diver shared never does.
 */
function PhotoGrid({
  photos,
  tripTitle,
  t,
  unshareAction,
}: {
  photos: AfterStateProps["photos"];
  tripTitle: string;
  t: DiverTranslator;
  unshareAction?: (formData: FormData) => void | Promise<void>;
}) {
  return (
    <ul className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3">
      {photos.map((image) => (
        <li key={image.id} className="overflow-hidden rounded-inset border border-border">
          <div className="relative aspect-square w-full">
            {/* Diver photos always come from the blob store
                (storeRecapImage), so the remotePatterns entry in
                next.config.ts covers every url here. */}
            <Image
              src={image.imageUrl}
              alt={image.caption ?? t("recap.photoAlt", { trip: tripTitle })}
              fill
              sizes="(min-width: 640px) 33vw, 50vw"
              className="object-cover"
            />
          </div>
          {image.caption || image.sharedBy || image.sharedWithBoat ? (
            <p className="px-2 py-1.5 text-xs text-muted">
              {image.sharedBy
                ? image.caption
                  ? t("recap.sharedByCaption", { name: image.sharedBy, caption: image.caption })
                  : t("recap.sharedBy", { name: image.sharedBy })
                : image.sharedWithBoat
                  ? image.caption
                    ? t("recap.sharedWithBoatCaption", { caption: image.caption })
                    : t("recap.sharedWithBoat")
                  : image.caption}
            </p>
          ) : null}
          {image.sharedWithBoat && !image.sharedBy && unshareAction ? (
            <form action={unshareAction} className="px-2 pb-1.5">
              <input type="hidden" name="photoId" value={image.id} />
              <SubmitButton
                pendingLabel={t("recap.stoppingSharing")}
                className={buttonClass({ variant: "link", size: "sm", flush: true })}
              >
                {t("recap.stopSharing")}
              </SubmitButton>
            </form>
          ) : null}
        </li>
      ))}
    </ul>
  );
}

/**
 * What the day's places are known to hold, for a next dive: closed on arrival
 * and never promoted, and absent entirely when no site names a species.
 */
export function FieldGuideDoor({
  t,
  groups,
}: {
  t: DiverTranslator;
  groups: { siteName: string; cards: ReturnType<typeof fieldGuideCards> }[];
}) {
  if (groups.length === 0) return null;
  return (
    <Door
      id="field-guide"
      summary={t("recap.fieldGuideTitle", { count: groups.length })}
      open={false}
    >
      <ul className="flex flex-col gap-6">
        {groups.map((site) => (
          <li key={site.siteName}>
            {/* The site's own name above its faces is what keeps this a
                statement about a place. Without it the list floats free
                and reads as the day's tally. */}
            <p className="text-sm font-semibold">{site.siteName}</p>
            <ul className="mt-3 grid gap-x-6 gap-y-5 sm:grid-cols-2">
              {site.cards.map((card) => (
                <li key={card.id} className="flex min-w-0 gap-3">
                  <StoredPhoto
                    // Capture-only rewrite; `src/lib/marine-life-tiles.ts`.
                    src={capturePhoto(card.imageUrl, 48)}
                    alt=""
                    className="size-12 shrink-0 rounded-inset"
                    sizes="48px"
                  />
                  <div className="min-w-0">
                    <p className="font-medium">{card.name}</p>
                    {card.description ? (
                      <p className="mt-1 text-sm leading-relaxed text-muted">{card.description}</p>
                    ) : null}
                  </div>
                </li>
              ))}
            </ul>
          </li>
        ))}
      </ul>
    </Door>
  );
}
