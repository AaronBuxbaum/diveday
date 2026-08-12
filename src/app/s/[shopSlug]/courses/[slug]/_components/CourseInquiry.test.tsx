// @vitest-environment jsdom
import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { renderDiver } from "@/test/intl";
import type { CourseInquiryFormState } from "../actions";
import { CourseInquiry, type CourseInquiryCopy } from "./CourseInquiry";

const copy: CourseInquiryCopy = {
  getInTouch: "Get in touch",
  noDateBody: "No date that works?",
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
  openInEmailApp: "Open in your email app",
  copyMessage: "Copy message",
  copied: "Copied",
  copyFailed: "Couldn't copy — the mail button beside it does the same job",
  orWriteTo: "Or write to",
  callLabel: "call",
  send: "Send inquiry",
  sending: "Sending…",
  sentHeading: "Inquiry sent",
  sentBody: "We'll be in touch.",
};

function renderInquiry(
  submitInquiry: (
    prevState: CourseInquiryFormState,
    formData: FormData,
  ) => Promise<CourseInquiryFormState>,
) {
  return renderDiver(
    <CourseInquiry
      submitInquiry={submitInquiry}
      courseTitle="Open Water Diver"
      shopName="Blue Mantis Divers"
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
    async (
      _prev: CourseInquiryFormState,
      _formData: FormData,
    ): Promise<CourseInquiryFormState> => ({ success: true }),
  );
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("CourseInquiry — experience is required (task 8)", () => {
  it("blocks the mailto composer and shows an inline error when no experience is picked", () => {
    const submitInquiry = vi.fn();
    renderInquiry(submitInquiry);

    const mailLink = screen.getByRole("link", { name: "Open in your email app" });
    fireEvent.click(mailLink);

    expect(screen.getByText("Let us know where you are up to before sending.")).toBeInTheDocument();
  });

  it("blocks the copy-message button when no experience is picked", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });
    const submitInquiry = vi.fn();
    renderInquiry(submitInquiry);

    fireEvent.click(screen.getByRole("button", { name: "Copy message" }));

    expect(screen.getByText("Let us know where you are up to before sending.")).toBeInTheDocument();
    expect(writeText).not.toHaveBeenCalled();
  });

  it("clears the inline error once an experience level is picked", () => {
    const submitInquiry = vi.fn();
    renderInquiry(submitInquiry);

    fireEvent.click(screen.getByRole("link", { name: "Open in your email app" }));
    expect(screen.getByText("Let us know where you are up to before sending.")).toBeInTheDocument();

    pickExperience();
    expect(
      screen.queryByText("Let us know where you are up to before sending."),
    ).not.toBeInTheDocument();
  });

  it("lets the mailto composer through once an experience level is picked", () => {
    const submitInquiry = vi.fn();
    renderInquiry(submitInquiry);

    fillEmail();
    pickExperience();
    fireEvent.click(screen.getByRole("link", { name: "Open in your email app" }));

    expect(
      screen.queryByText("Let us know where you are up to before sending."),
    ).not.toBeInTheDocument();
  });
});

describe("CourseInquiry — server-recorded submission", () => {
  it("records the inquiry and shows the confirmation on success (happy path)", async () => {
    const submitInquiry = vi.fn(
      async (
        _prev: CourseInquiryFormState,
        _formData: FormData,
      ): Promise<CourseInquiryFormState> => ({
        success: true,
      }),
    );
    renderInquiry(submitInquiry);

    fillEmail();
    pickExperience("tried");
    fireEvent.click(screen.getByRole("button", { name: "Send inquiry" }));

    await waitFor(() => expect(submitInquiry).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.getByText("Inquiry sent")).toBeInTheDocument());
    // The mailto/phone fallback the task asked to keep is still on screen
    // after a successful server-recorded send.
    expect(screen.getByText("hello@example.com")).toBeInTheDocument();
  });

  it("shows the server's error and keeps the form on screen (failure path)", async () => {
    const submitInquiry = vi.fn(
      async (): Promise<CourseInquiryFormState> => ({
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

describe("CourseInquiry — a lead the shop can answer", () => {
  // A question with no email and no phone is a lead nobody can reply to, so
  // every path out of the composer refuses it — including the two that never
  // touch the server.
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

  it("refuses the mailto composer when neither an email nor a phone is given", () => {
    renderInquiry(vi.fn());

    pickExperience();
    fireEvent.click(screen.getByRole("link", { name: "Open in your email app" }));

    expect(
      screen.getByText("Leave an email or a phone number so we can reply."),
    ).toBeInTheDocument();
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

describe("CourseInquiry — how many divers", () => {
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

describe("CourseInquiry — the composed message", () => {
  // The "your message so far" preview is gone; the buttons that carry that
  // message out of the page are not.
  it("shows no message preview, only the buttons and the shop's own details", () => {
    renderInquiry(vi.fn());

    expect(screen.queryByRole("region", { name: /message so far/i })).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Open in your email app" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Copy message" })).toBeInTheDocument();
    expect(screen.getByText("hello@example.com")).toBeInTheDocument();
  });

  it("still carries every answer into the mailto body", () => {
    renderInquiry(vi.fn());

    fillEmail();
    fireEvent.change(screen.getByLabelText(/When suits you/), {
      target: { value: "any weekend this autumn" },
    });
    pickExperience();

    const href = screen.getByRole("link", { name: "Open in your email app" }).getAttribute("href");
    expect(decodeURIComponent(href ?? "")).toContain("When: any weekend this autumn");
    expect(decodeURIComponent(href ?? "")).toContain("How many divers: 1");
  });
});
