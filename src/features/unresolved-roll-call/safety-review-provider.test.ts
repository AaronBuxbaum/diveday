import { beforeEach, expect, it, vi } from "vitest";

const sdk = vi.hoisted(() => ({ constructors: vi.fn(), send: vi.fn() }));
vi.mock("@aws-sdk/client-sesv2", async (original) => ({
  ...(await original<typeof import("@aws-sdk/client-sesv2")>()),
  SESv2Client: class {
    constructor(options: unknown) {
      sdk.constructors(options);
    }
    send = sdk.send;
  },
}));
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
  sdk.constructors.mockClear();
  sdk.send.mockReset();
});

it("uses one SDK attempt and refuses to start if already aborted or missing a signal", async () => {
  const provider = singleAttemptSafetyReviewProvider(config);
  expect(sdk.constructors).toHaveBeenCalledWith(expect.objectContaining({ maxAttempts: 1 }));
  const controller = new AbortController();
  controller.abort();
  expect(await provider.send(notice, { signal: controller.signal })).toMatchObject({
    status: "failed",
    errorCode: "aborted_before_send",
  });
  expect(await provider.send(notice)).toMatchObject({
    status: "failed",
    errorCode: "aborted_before_send",
  });
  expect(sdk.send).not.toHaveBeenCalled();
});

it("passes an abort to the one SDK call and settles when the simulated SDK aborts", async () => {
  sdk.send.mockImplementation(
    (_command, options: { abortSignal: AbortSignal }) =>
      new Promise((_resolve, reject) => {
        options.abortSignal.addEventListener(
          "abort",
          () => reject(Object.assign(new Error("abort"), { name: "AbortError" })),
          { once: true },
        );
      }),
  );
  const controller = new AbortController();
  const result = singleAttemptSafetyReviewProvider(config).send(notice, {
    signal: controller.signal,
  });
  expect(sdk.send).toHaveBeenCalledTimes(1);
  controller.abort();
  expect(await result).toMatchObject({ status: "failed" });
  expect(sdk.send).toHaveBeenCalledTimes(1);
});
