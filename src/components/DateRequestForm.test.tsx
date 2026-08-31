// @vitest-environment jsdom
import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { DateRequestCopy, InquiryFormState } from "@/lib/course-inquiry";
import { renderDiver } from "@/test/intl";
import { DateRequestForm } from "./DateRequestForm";

const copy: DateRequestCopy = {
  heading: "Get in touch",
  intro: "No date that works?",
  whatToDive: "What would you like to dive?",
  whatToDivePlaceholder: "Two dives on the wrecks",
  dateOptionsHeading: "When would you like to dive?",
  dateOptionsHint:
    "Choose a preferred date, an alternative, or tell us when your timing is flexible.",
  preferredDate: "Preferred date",
  alternateDate: "Alternative date",
  yourName: "Your name",
  namePlaceholder: "Priya Sharma",
  yourEmail: "Your email",
  emailPlaceholder: "you@example.com",
  yourPhone: "Your phone",
  phonePlaceholder: "+1 305 555 0134",
  howManyDivers: "How many divers",
  optional: "(optional)",
  required: "(required)",
  orPhone: "(or phone)",
  orEmail: "(or email)",
  whenSuits: "Flexible timing",
  whenSuitsPlaceholder: "Any weekend in August",
  whereYouAreUpTo: "Where you are up to",
  chooseOne: "Choose one",
  anythingElse: "Anything else",
  messagePlaceholder: "We are ashore on Tuesday.",
  orWriteTo: "Or write to",
  orCall: "Or call",
  callLabel: "call",
  send: "Send inquiry",
  sending: "Sending…",
  sentHeading: "Inquiry sent",
  sentBody: "We'll be in touch.",
};

function renderInquiry(
  submitInquiry: (prevState: InquiryFormState, formData: FormData) => Promise<InquiryFormState>,
  {
    askInterest = false,
    contactEmail = "hello@example.com",
    contactPhone = "+1 305 555 0134" as string | null,
    collapsible = false,
  }: {
    askInterest?: boolean;
    contactEmail?: string | null;
    contactPhone?: string | null;
    collapsible?: boolean;
  } = {},
) {
  return renderDiver(
    <DateRequestForm
      submitRequest={submitInquiry}
      askInterest={askInterest}
      contactEmail={contactEmail}
      contactPhone={contactPhone}
      collapsible={collapsible}
      copy={copy}
    />,
  );
}

/** Every send path needs a reply address; fill one so a test can assert on the rest. */
function fillEmail(value = "priya@example.com") {
  fireEvent.change(screen.getByLabelText(/Your email/), { target: { value } });
}

function pickExperience(value = "never") {
  fireEvent.change(screen.getByRole("combobox", { name: /Where you are up to/ }), {
    target: { value },
  });
}

/** A stub that always reports the inquiry as recorded. */
function succeeds() {
  return vi.fn(
    async (_prev: InquiryFormState, _formData: FormData): Promise<InquiryFormState> => ({
      success: true,
    }),
  );
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("DateRequestForm — experience is optional", () => {
  it("lets a contact send without choosing where they are up to", async () => {
    const submitInquiry = succeeds();
    renderInquiry(submitInquiry);

    fillEmail();
    fireEvent.click(screen.getByRole("button", { name: "Send inquiry" }));

    await waitFor(() => expect(submitInquiry).toHaveBeenCalledTimes(1));
    expect(submitInquiry.mock.calls[0]?.[1].get("experience")).toBeNull();
  });

  it("does not require the experience control in the browser", () => {
    renderInquiry(vi.fn());
    expect(screen.getByRole("combobox", { name: /Where you are up to/ })).not.toBeRequired();
  });

  it("includes the experience answer when the diver volunteers it", async () => {
    const submitInquiry = succeeds();
    renderInquiry(submitInquiry);

    fillEmail();
    pickExperience();
    fireEvent.click(screen.getByRole("button", { name: "Send inquiry" }));

    await waitFor(() => expect(submitInquiry).toHaveBeenCalledTimes(1));
    expect(submitInquiry.mock.calls[0]?.[1].get("experience")).toBe("never");
  });
});

describe("DateRequestForm — server-recorded submission", () => {
  it("records the inquiry and shows the confirmation on success (happy path)", async () => {
    const submitInquiry = vi.fn(
      async (_prev: InquiryFormState, _formData: FormData): Promise<InquiryFormState> => ({
        success: true,
      }),
    );
    renderInquiry(submitInquiry);

    fillEmail();
    pickExperience("tried");
    fireEvent.click(screen.getByRole("button", { name: "Send inquiry" }));

    await waitFor(() => expect(submitInquiry).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.getByText("Inquiry sent")).toBeInTheDocument());
    // The shop's own address and phone stay on screen after a successful
    // server-recorded send — the one way left to write to them directly.
    expect(screen.getByText("hello@example.com")).toBeInTheDocument();
  });

  /**
   * On the schedule page this form is one row of a group of disclosures, and a
   * row that has been answered drops its disclosure — the same as the deal list
   * and the find-my-link row beside it. Left collapsible, the chevron would go
   * on offering a form that no longer exists, and collapsing the row would hide
   * the only thing telling the reader their request was sent.
   */
  it("drops the disclosure once the request is sent, on the collapsible surface", async () => {
    const { container } = renderInquiry(succeeds(), { collapsible: true, contactEmail: null });

    fireEvent.click(container.querySelector("summary") as HTMLElement);
    fillEmail();
    pickExperience("tried");
    fireEvent.click(screen.getByRole("button", { name: "Send inquiry" }));

    await waitFor(() => expect(screen.getByText("Inquiry sent")).toBeInTheDocument());
    expect(container.querySelector("details")).toBeNull();
    // ...and the section surface keeps its own anatomy: no disclosure to drop.
    cleanup();
    renderInquiry(succeeds(), { contactEmail: null });
    expect(document.querySelector("details")).toBeNull();
  });

  it("shows the server's error and keeps the form on screen (failure path)", async () => {
    const submitInquiry = vi.fn(
      async (): Promise<InquiryFormState> => ({
        error: "Too many attempts. Please wait a few minutes and try again.",
      }),
    );
    renderInquiry(submitInquiry);

    fillEmail();
    pickExperience("certified");
    fireEvent.click(screen.getByRole("button", { name: "Send inquiry" }));

    await waitFor(() => expect(submitInquiry).toHaveBeenCalledTimes(1));
    await waitFor(() =>
      expect(
        screen.getByText("Too many attempts. Please wait a few minutes and try again."),
      ).toBeInTheDocument(),
    );
    // Still the composer, not the confirmation — a rejected attempt never
    // silently reads as a sent one.
    expect(screen.queryByText("Inquiry sent")).not.toBeInTheDocument();
    // The error text lands as soon as `setState` applies, but the
    // transition's own `isPending` flip to false can commit one tick later
    // (React 19 async-transition semantics) — wait for the button to relabel
    // rather than asserting on the same tick the error appears.
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Send inquiry" })).toBeInTheDocument(),
    );
  });
});

describe("DateRequestForm — a lead the shop can answer", () => {
  // A question with no email and no phone is a lead nobody can reply to, so
  // the composer refuses to send it at all.
  it("refuses the server send when neither an email nor a phone is given", () => {
    const submitInquiry = succeeds();
    renderInquiry(submitInquiry);

    pickExperience();
    fireEvent.click(screen.getByRole("button", { name: "Send inquiry" }));

    expect(
      screen.getByText("Leave an email or a phone number so we can reply."),
    ).toBeInTheDocument();
    expect(submitInquiry).not.toHaveBeenCalled();
  });

  it("accepts a phone number on its own — either one, never both", async () => {
    const submitInquiry = succeeds();
    renderInquiry(submitInquiry);

    fireEvent.change(screen.getByLabelText(/Your phone/), {
      target: { value: "+1 305 555 0199" },
    });
    pickExperience();
    fireEvent.click(screen.getByRole("button", { name: "Send inquiry" }));

    await waitFor(() => expect(submitInquiry).toHaveBeenCalledTimes(1));
    const formData = submitInquiry.mock.calls[0]?.[1];
    expect(formData.get("phone")).toBe("+1 305 555 0199");
    expect(formData.get("email")).toBeNull();
  });

  it("clears the refusal as soon as either box is typed into", () => {
    renderInquiry(vi.fn());

    pickExperience();
    fireEvent.click(screen.getByRole("button", { name: "Send inquiry" }));
    expect(
      screen.getByText("Leave an email or a phone number so we can reply."),
    ).toBeInTheDocument();

    fillEmail();
    expect(
      screen.queryByText("Leave an email or a phone number so we can reply."),
    ).not.toBeInTheDocument();
  });
});

describe("DateRequestForm — how many divers", () => {
  // One diver is the commonest answer by a distance; nobody should have to
  // fill in a field to say the obvious.
  it("starts at one diver", async () => {
    const submitInquiry = succeeds();
    renderInquiry(submitInquiry);

    expect(screen.getByLabelText(/How many divers/)).toHaveValue(1);

    fillEmail();
    pickExperience();
    fireEvent.click(screen.getByRole("button", { name: "Send inquiry" }));

    await waitFor(() => expect(submitInquiry).toHaveBeenCalledTimes(1));
    expect(submitInquiry.mock.calls[0]?.[1].get("divers")).toBe("1");
  });

  it("lets the box be cleared — an emptied count is a real answer, not a reset", async () => {
    const submitInquiry = succeeds();
    renderInquiry(submitInquiry);

    fireEvent.change(screen.getByLabelText(/How many divers/), { target: { value: "" } });
    fillEmail();
    pickExperience();
    fireEvent.click(screen.getByRole("button", { name: "Send inquiry" }));

    await waitFor(() => expect(submitInquiry).toHaveBeenCalledTimes(1));
    expect(submitInquiry.mock.calls[0]?.[1].get("divers")).toBeNull();
  });
});

describe("DateRequestForm — one way out of the form", () => {
  // Send is the whole choice. "Open in your email app" and "Copy message"
  // stood beside it as equal secondary buttons and both handed the diver a
  // draft to send themselves — no row recorded, no shop notified, and a
  // silent dead end on a phone with no mail client configured. What replaces
  // them is what was always underneath: the shop's own address and number.
  it("offers Send and the shop's own details, and no draft-it-yourself escape hatch", () => {
    renderInquiry(vi.fn());

    expect(screen.getByRole("button", { name: "Send inquiry" })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /email app/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /copy/i })).not.toBeInTheDocument();
    expect(screen.getByText("hello@example.com")).toBeInTheDocument();
    expect(screen.getByText("+1 305 555 0134")).toBeInTheDocument();
  });

  /**
   * **A shop with no contact details still takes requests.**
   *
   * The whole form used to be gated on the shop having an email, which is the
   * exact inverse of useful: a shop with no departures at all is the one whose
   * only public conversion is "tell me what you want and when", and it was
   * switched off. The request lands in `course_inquiries` and staff read it on
   * the Requests page — the email only ever fed the notification, which the
   * action already skips when there is none (issue #710).
   */
  it("still sends when the shop has no contact details, and offers to write to nobody", async () => {
    // It **sends**: the old version passed a `vi.fn()` it never invoked and
    // asserted only that the button existed, so the one word in its name that
    // mattered was untested.
    const submitInquiry = succeeds();
    renderInquiry(submitInquiry, { contactEmail: null, contactPhone: null });

    fillEmail();
    pickExperience();
    fireEvent.click(screen.getByRole("button", { name: "Send inquiry" }));
    await waitFor(() => expect(submitInquiry).toHaveBeenCalledTimes(1));

    // And offers no way out of the form, because there is none on file. Asked
    // by *role and href*: the old `queryByRole("link", { name: /mailto/i })`
    // was vacuous — a link's accessible name is the address it shows, never
    // the scheme, so it passed identically whether or not the link rendered.
    expect(screen.queryByText(/Or write to/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Or call/)).not.toBeInTheDocument();
    for (const link of screen.queryAllByRole("link")) {
      expect(link.getAttribute("href")).not.toMatch(/^(mailto|tel):/);
    }
  });

  /**
   * **A number with no email address is still a way to reach the shop.**
   *
   * The contact line hung off the email address alone, so a phone-only shop —
   * an ordinary small operation, and the one most likely to want the call —
   * had its number dropped from the one place a diver is told what to do when
   * the date they wanted is not on the board. The test above passed the whole
   * time, because it only ever asked about a shop with *neither*.
   */
  it("offers the phone number to a shop that has one and no email address", () => {
    renderInquiry(vi.fn(), { contactEmail: null, contactPhone: "+1 305 555 0134" });

    const call = screen.getByRole("link", { name: "+1 305 555 0134" });
    expect(call).toHaveAttribute("href", "tel:+13055550134");
    expect(screen.getByText(/Or call/)).toBeInTheDocument();
    // Not the email opener, which would be an offer to write to nobody.
    expect(screen.queryByText(/Or write to/)).not.toBeInTheDocument();
  });

  it("keeps both when the shop has both", () => {
    renderInquiry(vi.fn(), {
      contactEmail: "hello@example.com",
      contactPhone: "+1 305 555 0134",
    });

    expect(screen.getByRole("link", { name: "hello@example.com" })).toHaveAttribute(
      "href",
      "mailto:hello@example.com",
    );
    expect(screen.getByRole("link", { name: "+1 305 555 0134" })).toBeInTheDocument();
  });

  it("carries every answer to the server instead", async () => {
    const submitInquiry = succeeds();
    renderInquiry(submitInquiry);

    fillEmail();
    fireEvent.change(screen.getByLabelText(/Flexible timing/), {
      target: { value: "any weekend this autumn" },
    });
    pickExperience();
    fireEvent.click(screen.getByRole("button", { name: "Send inquiry" }));

    await waitFor(() => expect(submitInquiry).toHaveBeenCalledTimes(1));
    const formData = submitInquiry.mock.calls[0]?.[1];
    expect(formData.get("timing")).toBe("any weekend this autumn");
    expect(formData.get("divers")).toBe("1");
    expect(formData.get("experience")).toBe("never");
  });
});

describe("DateRequestForm — asking for a date", () => {
  // The dates are what make a request groupable at all ("four people could
  // make the 12th"); the free-text box beside them is what holds everything a
  // date cannot say, so both travel.
  it("carries a preferred and alternate date", async () => {
    const submitInquiry = succeeds();
    renderInquiry(submitInquiry);

    fillEmail();
    fireEvent.change(screen.getByLabelText(/Preferred date/), {
      target: { value: "2026-09-12" },
    });
    fireEvent.change(screen.getByLabelText(/Alternative date/), {
      target: { value: "2026-09-19" },
    });
    pickExperience();
    fireEvent.click(screen.getByRole("button", { name: "Send inquiry" }));

    await waitFor(() => expect(submitInquiry).toHaveBeenCalledTimes(1));
    const formData = submitInquiry.mock.calls[0]?.[1];
    expect(formData.get("preferredDate")).toBe("2026-09-12");
    expect(formData.get("alternateDate")).toBe("2026-09-19");
    expect(formData.get("dateFlexible")).toBeNull();
  });

  it("sends no date fields at all when the diver named none", async () => {
    const submitInquiry = succeeds();
    renderInquiry(submitInquiry);

    fillEmail();
    pickExperience();
    fireEvent.click(screen.getByRole("button", { name: "Send inquiry" }));

    await waitFor(() => expect(submitInquiry).toHaveBeenCalledTimes(1));
    const formData = submitInquiry.mock.calls[0]?.[1];
    expect(formData.get("preferredDate")).toBeNull();
    expect(formData.get("alternateDate")).toBeNull();
    expect(formData.get("dateFlexible")).toBeNull();
  });
});

describe("DateRequestForm — what the request is about", () => {
  // On a course page the URL says what it is about, so the form never asks.
  it("does not ask what to dive when a course is already named", () => {
    renderInquiry(vi.fn());
    expect(screen.queryByLabelText(/What would you like to dive/)).not.toBeInTheDocument();
  });

  it("refuses to send from the schedule page with nothing said about what to dive", () => {
    const submitInquiry = succeeds();
    renderInquiry(submitInquiry, { askInterest: true });

    fillEmail();
    pickExperience();
    fireEvent.click(screen.getByRole("button", { name: "Send inquiry" }));

    expect(screen.getByText("Tell us what you’d like to dive before sending.")).toBeInTheDocument();
    expect(submitInquiry).not.toHaveBeenCalled();
  });

  it("carries what the diver wants to dive once they say", async () => {
    const submitInquiry = succeeds();
    renderInquiry(submitInquiry, { askInterest: true });

    fireEvent.change(screen.getByLabelText(/What would you like to dive/), {
      target: { value: "Two dives on the wrecks" },
    });
    fillEmail();
    pickExperience();
    fireEvent.click(screen.getByRole("button", { name: "Send inquiry" }));

    await waitFor(() => expect(submitInquiry).toHaveBeenCalledTimes(1));
    expect(submitInquiry.mock.calls[0]?.[1].get("interest")).toBe("Two dives on the wrecks");
  });
});
