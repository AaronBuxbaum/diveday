/**
 * How the departure's add band seats someone. Inside the arrivals window
 * (`walkInDoorOpen`) the desk chooses on the band: a **booking**, or the
 * **counter**, where the person is standing at the desk and is seated as a
 * walk-in. Never inferred from the clock (desk review F1, #2737): the window
 * reaches a day and a half ahead, and every "Add a booking" door lands in it
 * meaning a booking. Outside the window there is nothing to choose.
 */
export type AddBandMode = "booking" | "counter";

export function addBandMode({
  walkInWindow,
  counter,
}: {
  walkInWindow: boolean;
  /** The desk chose the counter on the band (`?counter=1`). */
  counter: boolean;
}): AddBandMode | undefined {
  if (!walkInWindow) return undefined;
  return counter ? "counter" : "booking";
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
