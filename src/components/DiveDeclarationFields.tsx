"use client";

import { useTranslations } from "next-intl";
import { controlClass, Field } from "@/components/ui/form";
import { InfoHint } from "@/components/ui/InfoHint";
import { DIVER_CERTIFICATION_LEVEL_KEYS } from "@/i18n/readiness-labels";
import { NO_CERTIFICATION_ANSWER } from "@/lib/certification-options";

/** The optional certification-level question used by the public deal list. */
export function DiveCertificationField() {
  const t = useTranslations();

  return (
    <Field
      label={t("common.certification.level")}
      hint={t("common.optional")}
      aside={
        <InfoHint
          label={t("common.certification.levelInfoLabel")}
          detail={t("common.certification.levelDescription")}
        />
      }
    >
      <select name="certificationLevel" defaultValue="" className={controlClass}>
        <option value="">{t("common.certification.levelUnsaid")}</option>
        <option value={NO_CERTIFICATION_ANSWER}>{t("common.certification.levelNone")}</option>
        {Object.entries(DIVER_CERTIFICATION_LEVEL_KEYS).map(([value, key]) => (
          <option key={value} value={value}>
            {t(key)}
          </option>
        ))}
      </select>
    </Field>
  );
}
