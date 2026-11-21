import { SectionCard } from "@/components/ui/card";
import type { AppDb } from "@/db/client";
import type { ReadyPageData } from "@/features/boarding/ready";
import { getDiverPhotoState } from "@/features/people/person-photo";
import type { DiverTranslator } from "@/i18n/messages";
import type { DiverLocale } from "@/i18n/settings";
import { MAX_IMAGE_MB } from "@/lib/storage";
import { saveOwnPhotoAction } from "../person-photo-actions";
import { OwnPhotoControl } from "./OwnPhotoControl";
import { YourDays } from "./YourDays";

export function OwnPhotoAndDays({
  db,
  token,
  bookingId,
  data,
  delivered,
  locale,
  t,
}: {
  db: AppDb;
  token: string;
  bookingId: string;
  data: ReadyPageData;
  delivered: boolean;
  locale: DiverLocale;
  t: DiverTranslator;
}) {
  return (
    <>
      <OwnPhoto
        db={db}
        token={token}
        delivered={delivered}
        identityHeld={data.identityHeld}
        t={t}
      />
      <YourDays ready={{ db, token, bookingId, data, delivered }} locale={locale} t={t} />
    </>
  );
}

/** Only delivered, confirmed links get a control for this person's photo. */
export async function OwnPhoto({
  db,
  token,
  delivered,
  identityHeld,
  t,
}: {
  db: AppDb;
  token: string;
  delivered: boolean;
  identityHeld: boolean;
  t: DiverTranslator;
}) {
  if (!delivered || identityHeld) return null;
  const state = await getDiverPhotoState(db, { token });
  if (!state) return null;
  const photoUrl = state.privatePhoto
    ? `/ready/${encodeURIComponent(token)}/photo/${state.privatePhoto.assetId}`
    : null;
  return (
    <SectionCard className="mt-10" padding="lg" title={t("ready.ownPhoto.heading")}>
      <OwnPhotoControl
        photoUrl={photoUrl}
        hasPhoto={state.hasPhoto}
        action={saveOwnPhotoAction.bind(null, token)}
        words={{
          choose: t("ready.ownPhoto.choose"),
          chooseAnother: t("ready.ownPhoto.chooseAnother"),
          upload: t("ready.ownPhoto.upload"),
          uploading: t("ready.ownPhoto.uploading"),
          remove: t("ready.ownPhoto.remove"),
          saved: t("ready.ownPhoto.saved"),
          failed: t("ready.ownPhoto.failed"),
          rateLimited: t("ready.rateLimited"),
          wrongTypeSuffix: t("ready.ownPhoto.wrongTypeSuffix"),
          tooBigSuffix: t("ready.ownPhoto.tooBigSuffix", { maxMb: MAX_IMAGE_MB }),
        }}
      />
    </SectionCard>
  );
}
