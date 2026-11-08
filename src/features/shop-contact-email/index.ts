/** shop-contact-email public contract. Internals are imported only within this module. */
export type { IssuedContactEmailConfirmation } from "./store";
export {
  checkShopContactEmailConfirmation,
  consumeShopContactEmailConfirmation,
  issueShopContactEmailConfirmation,
  wasShopContactEmailConfirmed,
} from "./store";
