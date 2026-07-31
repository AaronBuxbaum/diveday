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
    const submitInquiry = vi.fn(async (): Promise<CourseInquiryFormState> => ({ success: true }));
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
    expect(screen.getByRole("button", { name: "Send inquiry" })).toBeInTheDocument();
  });
});
