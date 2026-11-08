/**
 * The calls where `src/db` takes its words from the page, with the English the page would hand
 * over already in place. A test of the data a call writes imports these instead of repeating the
 * lookup at every call site; a test of the wording itself passes its own.
 */

import { commitContactImport as commitContactImportWith } from "../features/import/store";

export { canPersonImportShopData } from "../features/import/store";

import { declinedSizeNote } from "@/i18n/import-notes";
import { marineLifeNamesIn } from "@/i18n/marine-life-labels";
import {
  type SendDueRecapsOptions,
  sendDueRecaps as sendDueRecapsWith,
  sendTripRecaps as sendTripRecapsWith,
} from "../features/recap/store";

type Db = Parameters<typeof sendDueRecapsWith>[0];
type TestSendOptions = Omit<SendDueRecapsOptions, "marineLifeNamesIn">;

export const commitContactImport = (
  ...args: [
    Parameters<typeof commitContactImportWith>[0],
    Parameters<typeof commitContactImportWith>[1],
    Parameters<typeof commitContactImportWith>[2],
    Parameters<typeof commitContactImportWith>[3],
  ]
) => commitContactImportWith(...args, declinedSizeNote);

export const sendDueRecaps = (db: Db, options: TestSendOptions = {}) =>
  sendDueRecapsWith(db, { marineLifeNamesIn, ...options });

export const sendTripRecaps = (
  db: Db,
  input: { shopId: string; tripId: string; options?: TestSendOptions },
) => sendTripRecapsWith(db, { ...input, options: { marineLifeNamesIn, ...input.options } });
