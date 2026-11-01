import { thrownErrorToken } from "@/lib/error-token";

export type AwsProviderErrorInfo = {
  retryable: boolean;
  httpStatus?: number;
  errorCode?: string;
  detail?: string;
};

/** Reduce an AWS SDK or pre-request error to the safe fields stored by a provider. */
export function awsProviderErrorInfo(
  error: unknown,
  throttleCodes: ReadonlySet<string>,
): AwsProviderErrorInfo {
  // Keep the SDK contract narrow: property presence, not class identity or metadata shape.
  const isAwsException = typeof error === "object" && error !== null && "$metadata" in error;
  const httpStatus = isAwsException
    ? (error as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode
    : undefined;
  const errorCode = isAwsException && error instanceof Error ? error.name : "network_error";
  const detail = isAwsException ? undefined : thrownErrorToken(error);
  const retryable =
    !isAwsException ||
    httpStatus === undefined ||
    httpStatus === 429 ||
    httpStatus >= 500 ||
    throttleCodes.has(errorCode);
  return { retryable, httpStatus, errorCode, detail };
}
