import type { DiverMessages } from "./messages";

/**
 * Types every `t("…")` call against the English bundle, so a typo or a key
 * removed from the JSON is a compile error rather than a string that renders
 * as its own key on a diver's screen.
 */
declare module "next-intl" {
  interface AppConfig {
    Messages: DiverMessages;
  }
}
