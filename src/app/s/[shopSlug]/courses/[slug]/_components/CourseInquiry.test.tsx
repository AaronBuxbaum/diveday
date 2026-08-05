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
  preferredDate: "A date you have in mind",
  preferredDateHint: "We'll tell you if it works — nothing is booked or held yet.",
  whenSuits: "When suits you",
  whenSuitsHint: "Rough is fine.",
  whenSuitsPlaceholder: "The week of 12 August",
  whereYouAreUpTo: "Where you are up to",
  chooseOne: "Choose one",
  anythingElse: "Anything else",
  messagePlaceholder: "We are ashore on Tuesday.",
  messageSoFar: "Your message so far",
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
      locale="en-US"
      today="2026-08-05"
      copy={copy}
    />,
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

    fireEvent.change(screen.getByRole("combobox", { name: /Where you are up to/ }), {
      target: { value: "never" },
    });
    expect(
      screen.queryByText("Let us know where you are up to before sending."),
    ).not.toBeInTheDocument();
  });

  it("lets the mailto composer through once an experience level is picked", () => {
    const submitInquiry = vi.fn();
    renderInquiry(submitInquiry);

    fireEvent.change(screen.getByRole("combobox", { name: /Where you are up to/ }), {
      target: { value: "never" },
    });
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

    fireEvent.change(screen.getByRole("combobox", { name: /Where you are up to/ }), {
      target: { value: "tried" },
    });
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

    fireEvent.change(screen.getByRole("combobox", { name: /Where you are up to/ }), {
      target: { value: "certified" },
    });
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

describe("CourseInquiry — proposing a date", () => {
  it("offers a date picker that cannot reach into the past", () => {
    renderInquiry(vi.fn());

    const picker = screen.getByLabelText(/A date you have in mind/);
    expect(picker).toHaveAttribute("type", "date");
    // Today where the *shop* is, not where the browser is: a diver who cannot
    // pick a day already gone never sends a request nobody can answer.
    expect(picker).toHaveAttribute("min", "2026-08-05");
  });

  // The preview is the whole point of the composer — a diver must see the date
  // they picked, written the way they read dates, before they send anything.
  it("writes the picked date into the message preview in the reader's locale", () => {
    renderInquiry(vi.fn());

    fireEvent.change(screen.getByLabelText(/A date you have in mind/), {
      target: { value: "2026-08-12" },
    });

    expect(screen.getByText(/Date I have in mind: August 12, 2026/)).toBeInTheDocument();
  });

  it("keeps the date line out of the preview until one is picked", () => {
    renderInquiry(vi.fn());
    expect(screen.queryByText(/Date I have in mind/)).not.toBeInTheDocument();
  });

  // The row stores a bare calendar day; the formatted string is for reading,
  // never for the column.
  it("posts the raw YYYY-MM-DD, not the formatted date", async () => {
    const submitInquiry = vi.fn(
      async (
        _prev: CourseInquiryFormState,
        _formData: FormData,
      ): Promise<CourseInquiryFormState> => ({
        success: true,
      }),
    );
    renderInquiry(submitInquiry);

    fireEvent.change(screen.getByLabelText(/A date you have in mind/), {
      target: { value: "2026-08-12" },
    });
    fireEvent.change(screen.getByRole("combobox", { name: /Where you are up to/ }), {
      target: { value: "never" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Send inquiry" }));

    await waitFor(() => expect(submitInquiry).toHaveBeenCalledTimes(1));
    const formData = submitInquiry.mock.calls[0]?.[1];
    expect(formData.get("preferredDate")).toBe("2026-08-12");
  });

  // A date is a *request*, not a booking: it must not become a required field,
  // and the rest of the composer must work without it.
  it("stays optional — an inquiry with no date still sends", async () => {
    const submitInquiry = vi.fn(
      async (
        _prev: CourseInquiryFormState,
        _formData: FormData,
      ): Promise<CourseInquiryFormState> => ({
        success: true,
      }),
    );
    renderInquiry(submitInquiry);

    fireEvent.change(screen.getByRole("combobox", { name: /Where you are up to/ }), {
      target: { value: "never" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Send inquiry" }));

    await waitFor(() => expect(submitInquiry).toHaveBeenCalledTimes(1));
    const formData = submitInquiry.mock.calls[0]?.[1];
    expect(formData.get("preferredDate")).toBeNull();
  });
});
