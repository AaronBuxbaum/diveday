// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CourseFormsQrButton, CourseFormsQrProvider } from "./CourseFormsQr";

const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));

const copy = {
  show: "Show QR code",
  showFor: "Show QR code for {name}",
  title: "Scan to sign",
  scan: "Scan with your phone",
  close: "Close",
  loading: "Preparing",
  failed: "Code unavailable",
};
afterEach(cleanup);

describe("course forms QR", () => {
  it("shows one student's code and discards a stale response after switching", async () => {
    let first!: (result: { ok: true; qr: string }) => void;
    const action = vi
      .fn()
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            first = resolve;
          }),
      )
      .mockResolvedValueOnce({ ok: true, qr: "data:image/png;base64,Qg==" });
    render(
      <CourseFormsQrProvider action={action} copy={copy}>
        <CourseFormsQrButton bookingId="a" name="Ada" />
        <CourseFormsQrButton bookingId="b" name="Bea" />
      </CourseFormsQrProvider>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Show QR code for Ada" }));
    expect(screen.getByRole("dialog")).toHaveTextContent("Ada");
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(refresh).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: "Show QR code for Bea" }));
    await act(async () => {});
    await act(async () => {
      first({ ok: true, qr: "data:image/png;base64,QQ==" });
    });
    expect(screen.getByRole("dialog")).toHaveTextContent("Bea");
    expect(screen.getByRole("img")).toHaveAttribute("src", "data:image/png;base64,Qg==");
    expect(screen.queryByText(/\/ready\//)).toBeNull();
  });

  it("shows a minor's code only after the desk confirms a guardian is here (issue 3986)", async () => {
    const action = vi
      .fn()
      .mockResolvedValueOnce({ ok: false, guardianCheck: true })
      .mockResolvedValueOnce({ ok: true, qr: "data:image/png;base64,Qg==" });
    render(
      <CourseFormsQrProvider
        action={action}
        copy={{
          ...copy,
          guardianCheck: "Is a guardian here?",
          guardianConfirm: "Yes, show the code",
        }}
      >
        <CourseFormsQrButton bookingId="m" name="Mia" />
      </CourseFormsQrProvider>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Show QR code for Mia" }));
    await act(async () => {});
    expect(screen.getByRole("dialog")).toHaveTextContent("Is a guardian here?");
    expect(screen.queryByRole("img")).toBeNull();
    expect(action).toHaveBeenLastCalledWith("m", undefined);
    fireEvent.click(screen.getByRole("button", { name: "Yes, show the code" }));
    await act(async () => {});
    expect(action).toHaveBeenLastCalledWith("m", true);
    expect(screen.getByRole("img")).toHaveAttribute("src", "data:image/png;base64,Qg==");
  });
});
