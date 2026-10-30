import { AssistFillButton } from "@/components/assists/AssistFillButton";
import { assistsAvailable } from "@/db/assists";
import { getDb } from "@/db/client";
import { staffTranslator } from "@/i18n/staff-messages";
import { RescheduleNotice } from "../../../_components/RescheduleNotice";
import { loadTranslationBox, ShopTextTranslation } from "../../../_components/ShopTextTranslation";
import { draftTripDescriptionAction } from "../../../content-assist-actions";
import {
  type DepartureDetailsSection,
  DetailsSection,
  type DetailsSectionContext,
} from "./DetailsSection";

/**
 * The details form, and under its Save row whatever the save set going: a
 * retime's reschedule notice (ux review 2026-10-11, item 1), count-free
 * progress with Undo. Outside the form, because the hold's Undo and
 * "Tell them" are a form of their own.
 */
export async function DetailsEditor({
  shop,
  context,
  held,
  tell,
  section,
}: {
  shop: { id: string; slug: string; defaultLocale: string };
  context: DetailsSectionContext;
  section: DepartureDetailsSection;
  held?: string;
  tell?: string;
}) {
  const t = staffTranslator(context.locale);
  if (section !== "departure")
    return (
      <>
        <DetailsSection context={context} section={section} />
        {held && (section === "timing" || section === "meeting") ? (
          <div className="mt-3">
            <RescheduleNotice
              shopId={context.trip.shopId}
              heldId={held}
              tell={tell}
              tripId={context.trip.id}
              t={t}
            />
          </div>
        ) : null}
      </>
    );
  // Claude's "Draft it" on the description, and the description's Spanish
  // beside the form (the `copywriter` and `shop-translate` assists).
  const db = await getDb();
  const canAssist = await assistsAvailable(db, shop.id);
  const descriptionTranslation = await loadTranslationBox(
    db,
    shop,
    { kind: "trip", id: context.trip.id, field: "description" },
    context.trip.description,
  );
  return (
    <>
      <DetailsSection
        section={section}
        context={{
          ...context,
          descriptionAssist: canAssist ? (
            <AssistFillButton
              draft={draftTripDescriptionAction.bind(null, shop.slug, context.trip.id)}
              label={t("deskAssists.draft")}
              pendingLabel={t("deskAssists.drafting")}
              emptyLabel={t("deskAssists.nothing")}
            />
          ) : undefined,
        }}
      />
      <div className="mt-5 max-w-2xl">
        <ShopTextTranslation
          shopSlug={shop.slug}
          box={descriptionTranslation}
          canAssist={canAssist}
          t={t}
          maxLength={500}
          label={t("deskAssists.translate.descriptionLabel")}
        />
      </div>
    </>
  );
}
