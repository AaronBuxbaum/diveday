import type { ReactNode } from "react";
import { SectionCard } from "@/components/ui/card";
import { ChoiceRow, controlClass, Field, FieldGrid, FormStatus } from "@/components/ui/form";
import type { DiverTranslator } from "@/i18n/messages";
import { SectionHeading } from "./SectionHeading";
import type { WAIVER_FIELD_ERROR, WaiverInvalidField } from "./waiver-fields";

/**
 * **The diver's signature**, the one card in the form — the formal act at the
 * end of a paper release gets the same visual weight here. The link's own
 * expiry sits in its fine print, next to "Save and finish later", because "can
 * I come back to this?" is asked at the moment of signing, not while reading
 * the page title. `children` is that fine print with the Sign button, passed
 * only when this is the last card (an adult's release; a minor's ends on the
 * guardian's card).
 *
 * No `title` prop: the heading is a `SectionHeading`, and the sections have to
 * announce themselves identically whether or not one happens to be boxed.
 * `padding="lg"` is the card someone works *inside*, and on a phone it is the
 * `p-5` this already had.
 */
export function SignatureCard({
  signerOnFile,
  record,
  namedFieldError,
  t,
  children,
}: {
  signerOnFile: { fullName: string } | null | undefined;
  record: { draftSignerName: string | null; draftAcknowledged: boolean };
  namedFieldError: (typeof WAIVER_FIELD_ERROR)[WaiverInvalidField] | undefined;
  t: DiverTranslator;
  children: ReactNode;
}) {
  return (
    <SectionCard padding="lg">
      <SectionHeading>{t("waiver.signature")}</SectionHeading>
      <FieldGrid columns={1} className="mt-4">
        <Field
          label={t("waiver.typeFullName")}
          // No `*` (visual review 2026-10-24, B56): this card asks for a
          // signature, and the typed name is it. The control stays `required`
          // and the server refuses a blank name with words on this field.
          markRequired={false}
          description={
            signerOnFile ? t("waiver.typeFullNameHint", { name: signerOnFile.fullName }) : undefined
          }
          // The refusal renders on the field it names — `Field` puts the
          // words under the control and wires `aria-invalid` +
          // `aria-describedby` for us — so the reader `FieldErrorFocus`
          // scrolls here finds the reason waiting beside the ringed box,
          // not a ring with its explanation stranded at the top of the
          // page.
          error={namedFieldError?.anchor === "signerName" ? t(namedFieldError.textKey) : undefined}
        >
          <input
            id="signerName"
            name="signerName"
            autoComplete="name"
            required
            minLength={2}
            maxLength={120}
            defaultValue={record.draftSignerName ?? ""}
            className={controlClass}
          />
        </Field>
      </FieldGrid>
      <ChoiceRow
        type="checkbox"
        id="acknowledged"
        name="acknowledged"
        value="on"
        required
        defaultChecked={record.draftAcknowledged}
        // The checkbox isn't a `Field`, so its refusal wiring is by
        // hand: the same aria pair `Field`'s `error` prop provides,
        // pointing at the message rendered just below.
        aria-invalid={namedFieldError?.anchor === "acknowledged" ? "true" : undefined}
        aria-describedby={
          namedFieldError?.anchor === "acknowledged" ? "acknowledged-error" : undefined
        }
        // Last in the card when the guardian's card carries the Sign
        // button, and then its target's unseen half sat under the
        // agreement, 37px to the border against 30px over the heading
        // (K-493). It gives that half back only while it ends the card.
        outdent="block-end"
        className="mt-4 text-base"
      >
        {t("waiver.agreementCheckbox")}
      </ChoiceRow>
      {namedFieldError?.anchor === "acknowledged" ? (
        <FormStatus id="acknowledged-error" className="mt-2">
          {t(namedFieldError.textKey)}
        </FormStatus>
      ) : null}
      {children}
    </SectionCard>
  );
}
