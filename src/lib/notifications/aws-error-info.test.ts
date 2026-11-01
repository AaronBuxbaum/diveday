import { describe, expect, it } from "vitest";
import { awsProviderErrorInfo } from "./aws-error-info";

describe("awsProviderErrorInfo", () => {
  it("uses metadata property presence and retries an untyped response with no status", () => {
    expect(awsProviderErrorInfo({ $metadata: null }, new Set())).toEqual({
      retryable: true,
      httpStatus: undefined,
      errorCode: "network_error",
      detail: undefined,
    });
  });

  it.each([
    { httpStatus: 400, retryable: false },
    { httpStatus: 429, retryable: true },
    { httpStatus: 503, retryable: true },
    { httpStatus: 302, retryable: false },
  ])("keeps shared HTTP retry semantics for status $httpStatus", ({ httpStatus, retryable }) => {
    const error = Object.assign(new Error("private provider prose"), {
      name: "ProviderException",
      $metadata: { httpStatusCode: httpStatus },
    });

    expect(awsProviderErrorInfo(error, new Set())).toEqual({
      retryable,
      httpStatus,
      errorCode: "ProviderException",
      detail: undefined,
    });
  });

  it("keeps provider throttle codes explicit and does not expose a network error message", () => {
    const networkError = new TypeError("private phone number +15550100");
    const sesCodes = new Set(["TooManyRequestsException"]);
    const snsCodes = new Set(["Throttling", "ThrottlingException", "ThrottledException"]);
    const throttleError = Object.assign(new Error("private provider prose"), {
      name: "Throttling",
      $metadata: { httpStatusCode: 400 },
    });

    expect(awsProviderErrorInfo(throttleError, snsCodes).retryable).toBe(true);
    expect(awsProviderErrorInfo(throttleError, sesCodes).retryable).toBe(false);
    const sesThrottle = Object.assign(new Error("private provider prose"), {
      name: "TooManyRequestsException",
      $metadata: { httpStatusCode: 400 },
    });
    expect(awsProviderErrorInfo(sesThrottle, sesCodes).retryable).toBe(true);
    expect(awsProviderErrorInfo(sesThrottle, snsCodes).retryable).toBe(false);
    expect(awsProviderErrorInfo(networkError, new Set())).toEqual({
      retryable: true,
      httpStatus: undefined,
      errorCode: "network_error",
      detail: "TypeError",
    });
  });
});
