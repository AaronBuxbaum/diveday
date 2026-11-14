import { Readable } from "node:stream";
import { beforeEach, expect, it, vi } from "vitest";

const transport = vi.hoisted(() => ({ handle: vi.fn() }));
vi.mock("@aws-sdk/client-sesv2", async (original) => {
  const actual = await original<typeof import("@aws-sdk/client-sesv2")>();
  return {
    ...actual,
    SESv2Client: class extends actual.SESv2Client {
      constructor(options: ConstructorParameters<typeof actual.SESv2Client>[0]) {
        super({ ...options, requestHandler: { handle: transport.handle, destroy() {} } as never });
      }
    },
  };
});
const { singleAttemptSafetyReviewProvider } = await import("./safety-review-provider");
const config = {
  region: "us-east-1",
  from: "DiveDay <mail@dive.day>",
  accessKeyId: "TEST",
  secretAccessKey: "TEST",
};
const notice = {
  kind: "unresolved_safety_evidence" as const,
  shopId: "2d14a07e-7a85-4849-b1d7-74fc8d998307",
  tripId: "3d14a07e-7a85-4849-b1d7-74fc8d998307",
  personId: "4d14a07e-7a85-4849-b1d7-74fc8d998307",
  generationId: "5d14a07e-7a85-4849-b1d7-74fc8d998307",
  to: "owner@reef.mail",
  locale: "en-US" as const,
  recipientName: "Ana",
  shopName: "Shop",
  tripTitle: "Trip",
  reviewUrl: "https://dive.day/shop/test/trips/3d14a07e-7a85-4849-b1d7-74fc8d998307/manifest",
};

beforeEach(() => {
  transport.handle.mockReset();
});

it("runs the real SDK middleware through one simulated failing HTTP request", async () => {
  transport.handle.mockResolvedValue({
    response: {
      statusCode: 503,
      headers: { "content-type": "application/json" },
      body: Readable.from(['{"message":"unavailable"}']),
    },
  });
  const result = await singleAttemptSafetyReviewProvider(config).send(notice, {
    signal: AbortSignal.timeout(5_000),
  });
  expect(result.status).toBe("failed");
  expect(transport.handle.mock.calls.length).toBe(1);
});

it("passes cancellation to the simulated HTTP handler without a second request", async () => {
  transport.handle.mockImplementation(
    (_request, options?: { abortSignal?: AbortSignal }) =>
      new Promise((_resolve, reject) => {
        if (!options?.abortSignal) return reject(new Error("missing abort signal"));
        if (options.abortSignal.aborted)
          return reject(Object.assign(new Error("aborted"), { name: "AbortError" }));
        options.abortSignal.addEventListener(
          "abort",
          () => reject(Object.assign(new Error("aborted"), { name: "AbortError" })),
          { once: true },
        );
      }),
  );
  const controller = new AbortController();
  const result = singleAttemptSafetyReviewProvider(config).send(notice, {
    signal: controller.signal,
  });
  await vi.waitFor(() => expect(transport.handle.mock.calls.length).toBe(1));
  expect(transport.handle.mock.calls[0]?.[1]).toMatchObject({ abortSignal: controller.signal });
  controller.abort();
  expect((await result).status).toBe("failed");
  expect(transport.handle.mock.calls.length).toBe(1);
});
