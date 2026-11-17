// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { Component, type ReactNode } from "react";
import { afterEach, expect, it, vi } from "vitest";
import { ClassroomActivityForm } from "./ClassroomActivityForm";

afterEach(cleanup);
it("keeps the draft and original attempt on a refusal, then uses a new attempt after success", async () => {
  const action = vi
    .fn()
    .mockResolvedValueOnce({ error: "No place was confirmed" })
    .mockResolvedValue({});
  render(
    <ClassroomActivityForm
      action={action}
      attemptId="first"
      label="Create"
      pendingLabel="Saving"
      retryLabel="Retry"
    >
      <label>
        Location
        <input name="location" />
      </label>
    </ClassroomActivityForm>,
  );
  fireEvent.change(screen.getByLabelText("Location"), {
    target: { value: "Sala con nombre largo" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Create" }));
  await screen.findByText("No place was confirmed");
  await waitFor(() => expect(screen.getByRole("button", { name: "Create" })).toBeEnabled());
  expect(screen.getByLabelText("Location")).toHaveValue("Sala con nombre largo");
  fireEvent.click(screen.getByRole("button", { name: "Create" }));
  await waitFor(() => expect(action).toHaveBeenCalledTimes(2));
  expect(action.mock.calls[0][1].get("attemptId")).toBe("first");
  expect(action.mock.calls[1][1].get("attemptId")).toBe("first");
  await waitFor(() => expect(screen.getByRole("button", { name: "Create" })).toBeEnabled());
  fireEvent.click(screen.getByRole("button", { name: "Create" }));
  await waitFor(() => expect(action).toHaveBeenCalledTimes(3));
  expect(action.mock.calls[2][1].get("attemptId")).not.toBe("first");
});
it("keeps the draft while pending and prevents a duplicate tap", async () => {
  let finish!: (value: { error?: string }) => void;
  const action = vi.fn(
    () =>
      new Promise<{ error?: string }>((resolve) => {
        finish = resolve;
      }),
  );
  render(
    <ClassroomActivityForm
      action={action}
      attemptId="first"
      label="Confirmar cupo después del contacto"
      pendingLabel="Guardando"
      retryLabel="Retry"
    >
      <label>
        Capacity
        <input name="capacity" defaultValue="8" />
      </label>
    </ClassroomActivityForm>,
  );
  fireEvent.click(screen.getByRole("button", { name: "Confirmar cupo después del contacto" }));
  await waitFor(() => expect(screen.getByRole("button", { name: "Guardando" })).toBeDisabled());
  expect(action).toHaveBeenCalledTimes(1);
  finish({});
  await waitFor(() =>
    expect(
      screen.getByRole("button", { name: "Confirmar cupo después del contacto" }),
    ).toBeEnabled(),
  );
});

it("preserves the draft and attempt after an uncertain transport failure", async () => {
  const action = vi.fn().mockRejectedValueOnce(new Error("transport closed")).mockResolvedValue({});
  render(
    <TransportBoundary>
      <ClassroomActivityForm
        action={action}
        attemptId="uncertain"
        label="Create"
        pendingLabel="Saving"
        retryLabel="Check the latest activity, then retry."
      >
        <label>
          Title
          <input name="title" />
        </label>
        <label>
          Location
          <input name="location" />
        </label>
      </ClassroomActivityForm>
    </TransportBoundary>,
  );
  fireEvent.change(screen.getByLabelText("Title"), {
    target: { value: "Fotografía de arrecifes" },
  });
  fireEvent.change(screen.getByLabelText("Location"), { target: { value: "Sala del muelle" } });
  fireEvent.click(screen.getByRole("button", { name: "Create" }));
  await screen.findByText("Check the latest activity, then retry.");
  expect(screen.getByLabelText("Title")).toHaveValue("Fotografía de arrecifes");
  expect(screen.getByLabelText("Location")).toHaveValue("Sala del muelle");
  fireEvent.click(screen.getByRole("button", { name: "Create" }));
  await waitFor(() => expect(action).toHaveBeenCalledTimes(2));
  expect(action.mock.calls[0][1].get("attemptId")).toBe("uncertain");
  expect(action.mock.calls[1][1].get("attemptId")).toBe("uncertain");
});

class TransportBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    return this.state.failed ? <p>Global failure</p> : this.props.children;
  }
}

it("does not swallow a Next authorization redirect as a transport failure", async () => {
  const redirect = Object.assign(new Error("NEXT_REDIRECT"), {
    digest: "NEXT_REDIRECT;replace;/sign-in;307;",
  });
  render(
    <TransportBoundary>
      <ClassroomActivityForm
        action={vi.fn().mockRejectedValue(redirect)}
        attemptId="auth"
        label="Create"
        pendingLabel="Saving"
        retryLabel="Retry"
      >
        <input name="title" />
      </ClassroomActivityForm>
    </TransportBoundary>,
  );
  fireEvent.click(screen.getByRole("button", { name: "Create" }));
  await screen.findByText("Global failure");
  expect(screen.queryByText("Retry")).toBeNull();
});
