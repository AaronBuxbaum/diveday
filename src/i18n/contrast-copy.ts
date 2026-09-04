import type { DiverTranslator } from "./messages";

/**
 * The four words the diver's contrast control renders (issue #1214).
 *
 * One builder rather than four keys spelled at each `ThreadShell` call site,
 * for the reason `readiness-labels.ts` exists: a surface that spells a key set
 * inline is a surface that can spell three of them and quietly ship the fourth
 * as a raw dotted string.
 *
 * **"Screen contrast", not "Boat mode."** The crew's manifest calls the same
 * control Boat mode because a crew reading it is on a boat. A diver holding
 * this link is on a dock, in a car, or on a hotel balcony the night before —
 * "Land mode" describes nothing they can see, and the honest label is what the
 * control actually changes.
 *
 * The shape is written out rather than imported from
 * `@/components/AmbientGlareDetector`: `pnpm check:architecture` refuses
 * `src/i18n` importing `src/components`, and rightly — words must not depend on
 * the thing that renders them. `AmbientContrastCopy` is still the authority,
 * and the two `ThreadShell` call sites are where the compiler reconciles them,
 * which is exactly where a drift would matter.
 */
export function diverContrastCopy(t: DiverTranslator): {
  modeLabel: string;
  labelAuto: string;
  labelStandard: string;
  labelFull: string;
} {
  return {
    modeLabel: t("common.contrast.modeLabel"),
    labelAuto: t("common.contrast.labelAuto"),
    labelStandard: t("common.contrast.labelStandard"),
    labelFull: t("common.contrast.labelFull"),
  };
}
