// DiveDay's own content for es-ES, one section per file: the marketing site and the
// switching guides (issue #2773). It is not the diver's chrome, so it does not
// live in ../diver.json; src/i18n/messages.ts composes it back under the same
// top-level keys, so `t("marketing.…")` and `t("switching.…")` read as before.
//
// pnpm check:locale proves the file sets match across locales and that every
// file is imported here, so a stray or orphaned section cannot ship.

import marketing from "./marketing.json";
import switching from "./switching.json";

const content = { marketing, switching };

export default content;
