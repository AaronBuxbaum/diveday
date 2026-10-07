/**
 * **What a refused paper release hands back to the form that produced it.**
 *
 * Recording a paper release for a minor is three typed things — the medical
 * attestation, the co-signer's name, the relationship — and until this existed
 * a refusal threw all three away: the action `redirect()`ed to the same route
 * with a `?notice=` code, the route re-rendered, and `PaperWaiverControl`'s
 * uncontrolled inputs came back empty. At a wet counter with a family waiting,
 * the staffer retyped the lot before they could correct the one thing the
 * notice named. It bites hardest on the namesake refusal, where the
 * confirmation tick only appears on the second pass (issue #1674).
 *
 * So a refusal stops navigating and answers in `useActionState` instead,
 * carrying the values back with it. **Deliberately not in the URL**: this state
 * travels in the action's own response body, while a `?notice=` carries every
 * parameter through the address bar, the browser's history, and every access
 * log between here and the shop — which is not where a named minor's
 * guardian's name goes. Nothing here is ever used to *pre-fill* a name the
 * staffer did not type: `personNamesMatch` is deliberately fuzzy
 * (`src/lib/person-name.ts`), so a pre-fill could silently change the spelling
 * on a document somebody is attesting to.
 *
 * The success path is untouched and still surface-specific — the roster and
 * the counter land in place, the diver's record redirects with its `?notice=`.
 *
 * In `src/lib` rather than beside the actions because `src/components` may not
 * import from `src/app` (`pnpm check:architecture`), and `PaperWaiverControl`
 * is the other half of this contract. Nothing here imports anything, so the
 * client bundle pays for three type aliases and one frozen object.
 */

/**
 * What the form says happened, in the form's own vocabulary rather than the
 * writer's. `recordInPersonWaiver` refuses for eleven reasons and a staffer can
 * act on three of them, so `paperWaiverRefusalFor`
 * (`src/app/actions/paper-waiver-fields.ts`) folds them down to these —
 * totally, so a new refusal reason is a type error there rather than a form
 * that says nothing.
 *
 * - `medical_attestation` — the tick was not given. Re-tick and resubmit.
 * - `guardian_name` — the co-signer's name is the diver's own (issue 1539).
 *   The one refusal an *honest* submission produces, and the only one with a
 *   way through: the namesake confirmation, offered on the surfaces where the
 *   staffer watched both people sign.
 * - `identity_unconfirmed` — the seat is still held over who the diver is
 *   (H-13), so no attestation may land on the matched person's history yet. The
 *   other refusal an *honest* submission produces, and the only one whose way
 *   through is a different control: confirm the identity on the row, then record
 *   the release.
 * - `error` — everything else. The form marks every field required, so
 *   reaching one of these means the request did not come from it.
 */
export type PaperWaiverRefusal =
  | "medical_attestation"
  | "guardian_name"
  | "identity_unconfirmed"
  | "error";

/**
 * The three things the staffer typed, echoed back so the form can stand them
 * up again. React resets an uncontrolled form after its action completes, so
 * these must come back as `defaultValue`/`defaultChecked` — the DOM does not
 * keep them for us even when nothing navigates.
 */
export type PaperWaiverTypedValues = {
  medicalAttested: boolean;
  guardianName: string;
  /** A `GuardianRelationship` code when it is one; whatever was submitted
   * otherwise, because the form has to be able to redraw a `<select>` that the
   * writer refused. Never trusted — `recordInPersonWaiver` re-reads it. */
  guardianRelationship: string;
};

export type PaperWaiverFormState =
  | { status: "idle" }
  | {
      status: "refused";
      refusal: PaperWaiverRefusal;
      typed: PaperWaiverTypedValues;
    };

/** The form at rest: before the first submit, and after one that landed. */
export const PAPER_WAIVER_IDLE: PaperWaiverFormState = { status: "idle" };

/**
 * The shape all three doors onto `recordInPersonWaiver` present to
 * `PaperWaiverControl` once their surface arguments are bound. Named here so a
 * fourth surface cannot quietly hand the control a plain `(formData) => void`
 * again — which type-checks against `<form action>` and loses every value.
 */
export type PaperWaiverAction = (
  state: PaperWaiverFormState,
  formData: FormData,
) => Promise<PaperWaiverFormState>;
