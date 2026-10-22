// @vitest-environment jsdom
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { type AccountSessionDisplayRow, AccountSessionsList } from "./AccountSessionsList";

afterEach(cleanup);

const labels = {
  thisDevice: "This device",
  details: "Details",
  browserLine: (browser: string) => `Browser: ${browser}`,
  networkLine: (network: string) => `Network: ${network}`,
  unknownDevice: "Unknown device",
  unknownIp: "Unknown network",
  revoke: "Revoke",
  revoking: "Revoking…",
};

describe("active account sessions", () => {
  it("keeps a long list reachable and marks only the server-identified session", () => {
    const currentId = "session-17";
    const rows: AccountSessionDisplayRow[] = Array.from({ length: 36 }, (_, index) => {
      const id = `session-${index}`;
      return {
        id,
        deviceLabel: `Chrome on Windows ${index}`,
        isCurrent: id === currentId,
        lastSeen: `last seen ${index}`,
        userAgent: `Chrome/125 Windows ${index}`,
        ipAddress: `192.0.2.${index}`,
      };
    });

    render(
      <AccountSessionsList
        rows={rows}
        labels={labels}
        shopSlug="blue-mantis"
        revokeAction={vi.fn(async () => {})}
      />,
    );

    const list = screen.getByRole("list");
    const items = within(list).getAllByRole("listitem");
    expect(items).toHaveLength(rows.length);
    expect(within(list).getByText("Chrome on Windows 35")).toBeVisible();
    expect(within(list).getAllByText(labels.thisDevice)).toHaveLength(1);

    for (const [index, item] of items.entries()) {
      const id = rows[index]?.id;
      expect(item.querySelector<HTMLInputElement>('input[name="sessionId"]')?.value).toBe(id);
      expect(within(item).getByRole("button", { name: labels.revoke })).toBeVisible();
      expect(within(item).queryByText(labels.thisDevice) !== null).toBe(id === currentId);
    }
  });

  it("says each detail as one bundle sentence, falling back to the unknown words", () => {
    render(
      <AccountSessionsList
        rows={[
          {
            id: "known",
            deviceLabel: "Chrome on Windows",
            isCurrent: false,
            lastSeen: "last seen today",
            userAgent: "Chrome/125 Windows",
            ipAddress: "192.0.2.1",
          },
          {
            id: "unknown",
            deviceLabel: "Unknown device",
            isCurrent: false,
            lastSeen: "last seen today",
            userAgent: null,
            ipAddress: null,
          },
        ]}
        labels={labels}
        shopSlug="blue-mantis"
        revokeAction={vi.fn(async () => {})}
      />,
    );
    expect(screen.getByText("Browser: Chrome/125 Windows")).toBeInTheDocument();
    expect(screen.getByText("Network: 192.0.2.1")).toBeInTheDocument();
    expect(screen.getByText("Browser: Unknown device")).toBeInTheDocument();
    expect(screen.getByText("Network: Unknown network")).toBeInTheDocument();
  });
});
