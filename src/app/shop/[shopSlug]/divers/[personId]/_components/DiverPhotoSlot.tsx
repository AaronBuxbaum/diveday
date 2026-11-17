import type { StaffTranslator } from "@/i18n/staff-messages";
import { MAX_IMAGE_MB } from "@/lib/storage";
import { savePersonPhotoAction } from "../photo-actions";
import { DiverPhotoControl } from "./DiverPhotoControl";

/** The diver page's photo control, wired to its action and copy. */
export function DiverPhotoSlot({
  shopSlug,
  personId,
  name,
  photoPath,
  t,
}: {
  shopSlug: string;
  personId: string;
  name: string;
  photoPath: string | null;
  t: StaffTranslator;
}) {
  return (
    <DiverPhotoControl
      name={name}
      photoPath={photoPath}
      action={savePersonPhotoAction.bind(null, shopSlug, personId)}
      copy={{
        add: t("divers.header.photoAdd"),
        change: t("divers.header.photoChange"),
        remove: t("divers.header.photoRemove"),
        adding: t("divers.header.photoAdding"),
        wrongTypeSuffix: t("shared.imageInput.wrongTypeSuffix"),
        tooBigSuffix: t("shared.imageInput.tooBigSuffix", { maxMb: MAX_IMAGE_MB }),
      }}
    />
  );
}
