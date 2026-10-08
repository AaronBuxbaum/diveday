Date: 2026-10-08
Project: i18n / dev server
Symptom: After adding a key to a staff bundle (`src/i18n/locales/<locale>/staff/<namespace>.json`) and using it in a component while `pnpm dev` was running, the page rendered the error boundary with `MISSING_MESSAGE` for that key. The component hot-reloaded but the JSON did not, and a screenshot taken then showed the crash, not the page. Typecheck and the built e2e were both fine.
Fix: Restart `pnpm dev` after editing a message bundle, before taking screenshots. Open every PNG you are about to hand over, including retakes.
