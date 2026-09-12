// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";
import { PaperWaiverControl } from "@/components/PaperWaiverControl";
import type { PaperWaiverCopy } from "@/components/paper-waiver-copy";
import type { PaperWaiverFormState, PaperWaiverRefusal } from "@/lib/paper-waiver-form";

/**
 * **What the staffer is still holding after a refusal** (issue #1674).
 *
 * Recording a paper release for a minor is three typed things: the medical
 * attestation, the co-signer's name, the relationship. Every refusal used to
 * `redirect()` back with a `?notice=`, which remounted these uncontrolled
 * inputs with no defaults — so correcting the one thing the notice named began
 * by retyping the other two, at a wet counter with a family waiting.
 *
 * The action's half of that is pinned in
 * `src/app/shop/[shopSlug]/divers/[personId]/paper-waiver.action.test.ts`: a
 * refusal answers with the values rather than a URL. **This file pins the half
 * only a DOM can answer**, and it is not a formality — React resets an
 * uncontrolled form once its action completes, so the values coming back in
 * `useActionState` is necessary and not sufficient. What has to be true is that
 * they are on screen.
 */

const COPY: PaperWaiverCopy = {
  markSignedOnPaper: "Signed on paper",
  medicalAttestationLabel: "I reviewed the medical questionnaire",
  recording: "Recording",
  recordPaperSignature: "Record paper signature",
  neverMind: "Never mind",
  guardian: {
    nameLabel: "Co-signer",
    relationshipLabel: "Relationship",
    relationshipChoose: "Choose one",
    relationshipOptions: [
      { value: "parent", label: "Parent" },
      { value: "legal_guardian", label: "Legal guardian" },
    ],
    namesakeLabel: "I watched both of them sign",
  },
  refusals: {
    medical_attestation: { text: "Confirm you reviewed the questionnaire.", tone: "warning" },
    guardian_name: { text: "The co-signer’s name is the diver’s own.", tone: "danger" },
    error: { text: "That paper waiver couldn’t be recorded.", tone: "danger" },
  },
};

/**
 * A door that refuses once and then accepts, echoing back whatever was
 * submitted — the same contract the three real actions hold to
 * (`paperWaiverRefused`). Built here rather than imported because
 * `src/components` may not reach into `src/app` (`pnpm check:architecture`).
 */
function refusingOnce(refusal: PaperWaiverRefusal) {
  const submitted: FormData[] = [];
  let refusalsLeft = 1;
  const action = async (
    _state: PaperWaiverFormState,
    formData: FormData,
  ): Promise<PaperWaiverFormState> => {
    submitted.push(formData);
    if (refusalsLeft-- <= 0) return { status: "idle" };
    return {
      status: "refused",
      refusal,
      typed: {
        medicalAttested: formData.get("medicalAttested") === "on",
        guardianName: String(formData.get("guardianName") ?? ""),
        guardianRelationship: String(formData.get("guardianRelationship") ?? ""),
      },
    };
  };
  return { action, submitted };
}

/** Opens the form for a minor and fills in all three fields. */
async function fillInAMinorsRelease(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole("button", { name: COPY.markSignedOnPaper }));
  await user.click(screen.getByLabelText(COPY.medicalAttestationLabel));
  await user.type(screen.getByLabelText(COPY.guardian.nameLabel), "Ama Boateng");
  await user.selectOptions(screen.getByLabelText(COPY.guardian.relationshipLabel), "parent");
}

function medicalBox() {
  return screen.getByLabelText(COPY.medicalAttestationLabel) as HTMLInputElement;
}

afterEach(cleanup);

describe("a refused paper release", () => {
  it("comes back with the medical tick, the co-signer and the relationship still in it", async () => {
    const user = userEvent.setup();
    const { action, submitted } = refusingOnce("medical_attestation");
    render(<PaperWaiverControl action={action} bookingId="b-1" copy={COPY} requiresGuardian />);

    await fillInAMinorsRelease(user);
    await user.click(screen.getByRole("button", { name: COPY.recordPaperSignature }));

    await waitFor(() =>
      expect(screen.getByText(COPY.refusals.medical_attestation.text)).toBeInTheDocument(),
    );
    // The form is still standing — it never navigated — and so is every value.
    expect(medicalBox()).toBeChecked();
    expect(screen.getByLabelText(COPY.guardian.nameLabel)).toHaveValue("Ama Boateng");
    expect(screen.getByLabelText(COPY.guardian.relationshipLabel)).toHaveValue("parent");
    // And the seat the recording is filed against survived with them.
    expect(submitted[0]?.get("bookingId")).toBe("b-1");
  });

  it("carries those values into the retry rather than silently dropping them", async () => {
    const user = userEvent.setup();
    const { action, submitted } = refusingOnce("medical_attestation");
    render(<PaperWaiverControl action={action} bookingId="b-1" copy={COPY} requiresGuardian />);

    await fillInAMinorsRelease(user);
    await user.click(screen.getByRole("button", { name: COPY.recordPaperSignature }));
    await waitFor(() => expect(submitted).toHaveLength(1));
    // The staffer's only remaining act: the one thing the refusal named.
    await user.click(screen.getByRole("button", { name: COPY.recordPaperSignature }));

    await waitFor(() => expect(submitted).toHaveLength(2));
    expect(submitted[1]?.get("medicalAttested")).toBe("on");
    expect(submitted[1]?.get("guardianName")).toBe("Ama Boateng");
    expect(submitted[1]?.get("guardianRelationship")).toBe("parent");
  });

  /**
   * The refusal an *honest* submission produces (issue 1539), and the reason
   * this matters most: the namesake confirmation exists only on the second
   * pass, so before this the staffer retyped all three values to reach the one
   * new box.
   */
  it("offers the namesake confirmation with everything they typed still beside it", async () => {
    const user = userEvent.setup();
    const { action } = refusingOnce("guardian_name");
    render(
      <PaperWaiverControl
        action={action}
        bookingId="b-1"
        copy={COPY}
        requiresGuardian
        offersNamesake
      />,
    );

    expect(screen.queryByLabelText(COPY.guardian.namesakeLabel)).toBeNull();
    await fillInAMinorsRelease(user);
    await user.click(screen.getByRole("button", { name: COPY.recordPaperSignature }));

    await waitFor(() =>
      expect(screen.getByLabelText(COPY.guardian.namesakeLabel)).toBeInTheDocument(),
    );
    expect(medicalBox()).toBeChecked();
    expect(screen.getByLabelText(COPY.guardian.nameLabel)).toHaveValue("Ama Boateng");
    expect(screen.getByLabelText(COPY.guardian.relationshipLabel)).toHaveValue("parent");
  });

  /**
   * The diver's record is the absentee door, so the tick — an assertion that
   * this staffer watched two people sign — is never drawn there, refusal or
   * not. The values still come back; only the way through does not.
   */
  it("withholds the namesake confirmation on a surface that does not offer it", async () => {
    const user = userEvent.setup();
    const { action } = refusingOnce("guardian_name");
    render(<PaperWaiverControl action={action} copy={COPY} requiresGuardian />);

    await fillInAMinorsRelease(user);
    await user.click(screen.getByRole("button", { name: COPY.recordPaperSignature }));

    await waitFor(() =>
      expect(screen.getByText(COPY.refusals.guardian_name.text)).toBeInTheDocument(),
    );
    expect(screen.queryByLabelText(COPY.guardian.namesakeLabel)).toBeNull();
    expect(screen.getByLabelText(COPY.guardian.nameLabel)).toHaveValue("Ama Boateng");
  });

  /**
   * The other way the tick can appear: a page-level `?notice=` that named this
   * booking, before any submit here. The counter's refused-form visual capture
   * is taken that way, and it stays a habit fence rather than an enforcement —
   * what contains the assertion is the writer, which honours it only when the
   * two names genuinely match.
   */
  it("draws the namesake confirmation for a page notice too, but never where the surface says no", async () => {
    const { action } = refusingOnce("guardian_name");
    const { rerender } = render(
      <PaperWaiverControl
        action={action}
        bookingId="b-1"
        copy={COPY}
        requiresGuardian
        offersNamesake
        noticedNamesake
        defaultOpen
      />,
    );

    expect(screen.getByLabelText(COPY.guardian.namesakeLabel)).toBeInTheDocument();

    rerender(
      <PaperWaiverControl
        action={action}
        bookingId="b-1"
        copy={COPY}
        requiresGuardian
        noticedNamesake
        defaultOpen
      />,
    );

    expect(screen.queryByLabelText(COPY.guardian.namesakeLabel)).toBeNull();
  });

  it("forgets what was typed when the staffer backs out", async () => {
    const user = userEvent.setup();
    const { action } = refusingOnce("medical_attestation");
    render(<PaperWaiverControl action={action} bookingId="b-1" copy={COPY} requiresGuardian />);

    await fillInAMinorsRelease(user);
    await user.click(screen.getByRole("button", { name: COPY.recordPaperSignature }));
    await waitFor(() =>
      expect(screen.getByText(COPY.refusals.medical_attestation.text)).toBeInTheDocument(),
    );
    await user.click(screen.getByRole("button", { name: COPY.neverMind }));
    await user.click(screen.getByRole("button", { name: COPY.markSignedOnPaper }));

    // "Never mind" means it: a form that quietly remembered the last attempt's
    // co-signer would be standing a name up on a legal release nobody retyped.
    expect(medicalBox()).not.toBeChecked();
    expect(screen.getByLabelText(COPY.guardian.nameLabel)).toHaveValue("");
    expect(screen.getByLabelText(COPY.guardian.relationshipLabel)).toHaveValue("");
    expect(screen.queryByText(COPY.refusals.medical_attestation.text)).toBeNull();
  });

  it("says nothing extra when the recording lands", async () => {
    const user = userEvent.setup();
    const { action, submitted } = refusingOnce("error");
    // `refusalsLeft` is spent by the first submit, so the second one succeeds.
    render(<PaperWaiverControl action={action} copy={COPY} />);

    await user.click(screen.getByRole("button", { name: COPY.markSignedOnPaper }));
    await user.click(screen.getByLabelText(COPY.medicalAttestationLabel));
    await user.click(screen.getByRole("button", { name: COPY.recordPaperSignature }));
    await waitFor(() => expect(screen.getByText(COPY.refusals.error.text)).toBeInTheDocument());
    await user.click(screen.getByRole("button", { name: COPY.recordPaperSignature }));

    await waitFor(() => expect(submitted).toHaveLength(2));
    expect(screen.queryByText(COPY.refusals.error.text)).toBeNull();
    expect(screen.queryByRole("alert")).toBeNull();
  });
});
