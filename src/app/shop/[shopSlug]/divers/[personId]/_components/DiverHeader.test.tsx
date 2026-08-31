// @vitest-environment jsdom
import { cleanup, render } from "@testing-library/react";
import type { ComponentProps } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { staffTranslator } from "@/i18n/staff-messages";
import { DiverHeader } from "./DiverHeader";
import type { DiverProfile } from "./shared";

vi.mock("../actions", () => ({ savePersonAction: vi.fn() }));

afterEach(cleanup);

const t = staffTranslator("en-US");
type HeaderStatus = ComponentProps<typeof DiverHeader>["status"];

function diver(): DiverProfile {
  return {
    person: {
      id: "person-1",
      fullName: "Mira Castellanos",
      email: "mira@example.test",
      phone: "+1 305 555 0142",
      diveInsurance: null,
      dateOfBirth: null,
      emergencyContactName: null,
      emergencyContactPhone: null,
      deletedAt: null,
    },
  } as unknown as DiverProfile;
}

function renderHeader({
  editOpen = false,
  status,
}: {
  editOpen?: boolean;
  status?: HeaderStatus;
} = {}) {
  return render(
    <DiverHeader
      diver={diver()}
      shopSlug="blue-mantis"
      personId="person-1"
      t={t}
      visits={0}
      book={<span>Book a departure</span>}
      editOpen={editOpen}
      status={status}
    />,
  );
}

describe("DiverHeader edit disclosure", () => {
  it("keeps the summary in the action row while its full-width form is open", () => {
    const { container } = renderHeader({ editOpen: true });
    const details = container.querySelector("details");
    const summary = container.querySelector<HTMLElement>("#edit-details");

    expect(details).not.toBeNull();
    expect(details).toHaveAttribute("open");
    expect(summary?.tagName).toBe("SUMMARY");
    expect(details).toHaveClass("group", "open:contents");
    expect(details).not.toHaveClass("open:w-full");
    expect(summary).toHaveClass("inline-flex", "min-h-11", "items-center");
    expect(details?.querySelector("form")).toHaveClass("w-full");
    expect(details?.parentElement).toHaveClass("flex", "flex-wrap");

    summary?.focus();
    expect(document.activeElement).toBe(summary);
  });

  it("honors an initially open editor and keeps a danger notice with it", () => {
    const status: HeaderStatus = {
      form: "details",
      tone: "danger",
      text: "Could not save the diver details.",
    };
    const { container, getByRole } = renderHeader({ editOpen: true, status });
    const details = container.querySelector("details");

    expect(details).toHaveAttribute("open");
    expect(getByRole("alert")).toHaveTextContent(status.text);
  });
});
