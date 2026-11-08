/** boat-snags public contract. Internals are imported only within this module. */
export type { OpenSnag, SailedWithSnag, ShopOpenSnag, SnagWriteOutcome } from "./store";
export {
  answerSnag,
  noteSnag,
  openSnagsForShop,
  openSnagsForTrip,
  snagsOpenWhenSailed,
} from "./store";
