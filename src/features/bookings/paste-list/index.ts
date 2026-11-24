/**
 * **Paste a list onto one departure** ("Try it Saturday", item 1): `read.ts`
 * turns pasted rows into people, `store.ts` finds who is on file and seats
 * everybody, each on a booking of their own.
 */
export {
  PASTE_CHOICE_FIELD,
  PASTE_LIST_MAX_ROWS,
  type PastedContactDrop,
  type PastedPerson,
  type PasteListRead,
  type PasteListRefusal,
  readPastedList,
} from "./read";
export {
  matchPastedPeople,
  PASTE_NEW_PERSON,
  type PasteCandidate,
  type PastedSeatOutcome,
  type PastedSeatRequest,
  type PasteMatch,
  seatPastedList,
} from "./store";
