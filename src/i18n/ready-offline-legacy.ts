import en from "./locales/en-US/ready-offline-legacy.json";
import es from "./locales/es-ES/ready-offline-legacy.json";

/** Exact old banner text mapped to the localized unknown-time warning. */
export const LEGACY_READY_BANNER_COPY = new Map([
  [
    "No signal: this is the copy your phone saved. Anything you change here needs signal.",
    {
      savedCopyWarning: en.savedCopyWarning,
      clockRollbackHeading: en.clockRollbackHeading,
      clockRollbackUnknown: en.clockRollbackUnknown,
      clockUnverified: en.clockUnverified,
    },
  ],
  [
    "Sin cobertura: esta es la copia que guardó tu teléfono. Para cambiar algo aquí necesitas cobertura.",
    {
      savedCopyWarning: es.savedCopyWarning,
      clockRollbackHeading: es.clockRollbackHeading,
      clockRollbackUnknown: es.clockRollbackUnknown,
      clockUnverified: es.clockUnverified,
    },
  ],
]);
