/** worth-a-look public contract. Internals are imported only within this module. */
export type {
  PartOfDay,
  WorthALookCandidate,
  WorthALookDeparture,
  WorthALookReason,
  WorthALookSubject,
} from "./rules";
export { asksNoMoreThan, worthALook } from "./rules";
