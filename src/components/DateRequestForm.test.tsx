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
  preferredDate: "Date you’d like",
  alternateDate: "Or this date",
  datesHint: "A request, not a booking.",
  dateFlexible: "Either of those, or a few days either side, works for me",
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
  whenSuits: "When suits you",
  whenSuitsHint: "As exact or as loose as you like.",
  whenSuitsPlaceholder: "12 August, or any weekend this autumn",
  whereYouAreUpTo: "Where you are up to",
  chooseOne: "Choose one",
  anythingElse: "Anything else",
  messagePlaceholder: "We are ashore on Tuesday.",
  orWriteTo: "Or write to",
  callLabel: "call",
  send: "Send inquiry",
  sending: "Sending…",
  sentHeading: "Inquiry sent",
  sentBody: "We'll be in touch.",
};

function renderInquiry(
  submitInquiry: (prevState: InquiryFormState, formData: FormData) => Promise<InquiryFormState>,
  { askInterest = false }: { askInterest?: boolean } = {},
) {
  return renderDiver(
    <DateRequestForm
      submitRequest={submitInquiry}
      askInterest={askInterest}
      contactEmail="hello@example.com"
      contactPhone="+1 305 555 0134"
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

describe("DateRequestForm — experience is required (task 8)", () => {
  it("blocks the send and shows an inline error when no experience is picked", () => {
    const submitInquiry = vi.fn();
    renderInquiry(submitInquiry);

    fillEmail();
    fireEvent.click(screen.getByRole("button", { name: "Send inquiry" }));

    expect(screen.getByText("Let us know where you are up to before sending.")).toBeInTheDocument();
    expect(submitInquiry).not.toHaveBeenCalled();
  });

  it("clears the inline error once an experience level is picked", () => {
    const submitInquiry = vi.fn();
    renderInquiry(submitInquiry);

    fireEvent.click(screen.getByRole("button", { name: "Send inquiry" }));
    expect(screen.getByText("Let us know where you are up to before sending.")).toBeInTheDocument();

    pickExperience();
    expect(
      screen.queryByText("Let us know where you are up to before sending."),
    ).not.toBeInTheDocument();
  });

  it("lets the send through once an experience level is picked", async () => {
    const submitInquiry = succeeds();
    renderInquiry(submitInquiry);

    fillEmail();
    pickExperience();
    fireEvent.click(screen.getByRole("button", { name: "Send inquiry" }));

    await waitFor(() => expect(submitInquiry).toHaveBeenCalledTimes(1));
    expect(
      screen.queryByText("Let us know where you are up to before sending."),
    ).not.toBeInTheDocument();
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

  it("carries every answer to the server instead", async () => {
    const submitInquiry = succeeds();
    renderInquiry(submitInquiry);

    fillEmail();
    fireEvent.change(screen.getByLabelText(/When suits you/), {
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
  it("carries a preferred date, an alternate, and the flexible flag", async () => {
    const submitInquiry = succeeds();
    renderInquiry(submitInquiry);

    fillEmail();
    fireEvent.change(screen.getByLabelText(/Date you’d like/), {
      target: { value: "2026-09-12" },
    });
    fireEvent.change(screen.getByLabelText(/Or this date/), { target: { value: "2026-09-19" } });
    fireEvent.click(screen.getByRole("checkbox", { name: /a few days either side/ }));
    pickExperience();
    fireEvent.click(screen.getByRole("button", { name: "Send inquiry" }));

    await waitFor(() => expect(submitInquiry).toHaveBeenCalledTimes(1));
    const formData = submitInquiry.mock.calls[0]?.[1];
    expect(formData.get("preferredDate")).toBe("2026-09-12");
    expect(formData.get("alternateDate")).toBe("2026-09-19");
    expect(formData.get("dateFlexible")).toBe("on");
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
