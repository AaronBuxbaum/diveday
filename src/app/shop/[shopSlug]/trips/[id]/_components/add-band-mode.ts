/**
 * How the departure's add band seats someone. Inside the arrivals window
 * (`walkInDoorOpen`) the person is usually standing at the desk, so the band is
 * the **counter**: one search field, a name is enough to seat them, and the seat
 * is filed as a walk-in. There is no choice to make. A band answering a date
 * request is never the counter (its party asked ahead, with an email), and
 * outside the window the band books.
 */
export type AddBandMode = "counter";

export function addBandMode({
  walkInWindow,
  hasRequest,
}: {
  walkInWindow: boolean;
  /** The band was opened from a date request (`?request=`). */
  hasRequest: boolean;
}): AddBandMode | undefined {
  return walkInWindow && !hasRequest ? "counter" : undefined;
}

/** The two seat actions the band binds: the walk-in door at the counter only. */
export function addBandSeatActions<A>(
  mode: AddBandMode | undefined,
  actions: {
    addBookingAction: A;
    addExistingDiverAction: A;
    walkInAddBookingAction: A;
    walkInAddExistingDiverAction: A;
  },
): { addBookingAction: A; addExistingDiverAction: A } {
  return mode === "counter"
    ? {
        addBookingAction: actions.walkInAddBookingAction,
        addExistingDiverAction: actions.walkInAddExistingDiverAction,
      }
    : {
        addBookingAction: actions.addBookingAction,
        addExistingDiverAction: actions.addExistingDiverAction,
      };
}
