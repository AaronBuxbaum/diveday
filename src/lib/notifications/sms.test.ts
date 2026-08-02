import type { PublishCommand } from "@aws-sdk/client-sns";
import { describe, expect, it, vi } from "vitest";
import { notifySms, smsProviderFromEnvironment, smsRecipient, snsSmsProvider } from "./sms";

describe("smsRecipient", () => {
  it("accepts and cleans an E.164 number", () => {
    expect(smsRecipient("+1 (305) 555-1234")).toBe("+13055551234");
    expect(smsRecipient("+13055551234")).toBe("+13055551234");
  });

  it("rejects anything without an unambiguous country code", () => {
    expect(smsRecipient("305-555-1234")).toBeNull();
    expect(smsRecipient("555-1234")).toBeNull();
    expect(smsRecipient("")).toBeNull();
    expect(smsRecipient(null)).toBeNull();
    expect(smsRecipient(undefined)).toBeNull();
  });
});

const message = { to: "+13055551234", body: "See you Saturday" };

const snsConfig = {
  region: "us-east-1",
  accessKeyId: "AKIA_TEST",
  secretAccessKey: "test-secret",
};

describe("snsSmsProvider (ADR 20260802-sns-sms-adapter)", () => {
  it("publishes through the injected SNS client and returns its message id", async () => {
    const client = { send: vi.fn().mockResolvedValue({ MessageId: "sns-message-id" }) };
    const provider = snsSmsProvider(snsConfig, { client });

    await expect(notifySms(message, provider)).resolves.toEqual({
      status: "sent",
      providerMessageId: "sns-message-id",
    });
    expect(client.send).toHaveBeenCalledTimes(1);
    const command = client.send.mock.calls[0]?.[0] as PublishCommand;
    expect(command.input).toMatchObject({
      PhoneNumber: "+13055551234",
      Message: "See you Saturday",
      MessageAttributes: {
        "AWS.SNS.SMS.SMSType": { DataType: "String", StringValue: "Transactional" },
      },
    });
    expect(command.input.MessageAttributes).not.toHaveProperty("AWS.SNS.SMS.SenderID");
  });

  it("sets a sender ID attribute when one is configured", async () => {
    const client = { send: vi.fn().mockResolvedValue({ MessageId: "sns-message-id" }) };
    const provider = snsSmsProvider({ ...snsConfig, senderId: "DiveDay" }, { client });

    await notifySms(message, provider);
    const command = client.send.mock.calls[0]?.[0] as PublishCommand;
    expect(command.input.MessageAttributes?.["AWS.SNS.SMS.SenderID"]).toEqual({
      DataType: "String",
      StringValue: "DiveDay",
    });
  });

  it("treats a response with no MessageId as a retryable failure", async () => {
    const client = { send: vi.fn().mockResolvedValue({}) };
    const provider = snsSmsProvider(snsConfig, { client });

    await expect(notifySms(message, provider)).resolves.toEqual({
      status: "failed",
      retryable: true,
      errorCode: "invalid_response",
    });
  });

  it("marks a thrown 4xx SNS error as non-retryable and surfaces its code", async () => {
    const error = Object.assign(new Error("Invalid parameter: PhoneNumber"), {
      name: "InvalidParameterException",
      $metadata: { httpStatusCode: 400 },
    });
    const client = { send: vi.fn().mockRejectedValue(error) };
    const provider = snsSmsProvider(snsConfig, { client });

    await expect(notifySms(message, provider)).resolves.toEqual({
      status: "failed",
      retryable: false,
      httpStatus: 400,
      errorCode: "InvalidParameterException",
      detail: "Invalid parameter: PhoneNumber",
    });
  });

  it("marks a thrown throttling error as retryable", async () => {
    const error = Object.assign(new Error("Rate exceeded"), {
      name: "ThrottledException",
      $metadata: { httpStatusCode: 429 },
    });
    const client = { send: vi.fn().mockRejectedValue(error) };
    const provider = snsSmsProvider(snsConfig, { client });

    await expect(notifySms(message, provider)).resolves.toMatchObject({
      status: "failed",
      retryable: true,
      httpStatus: 429,
    });
  });

  it("marks a thrown 5xx SNS error as retryable", async () => {
    const error = Object.assign(new Error("Internal error"), {
      name: "InternalErrorException",
      $metadata: { httpStatusCode: 500 },
    });
    const client = { send: vi.fn().mockRejectedValue(error) };
    const provider = snsSmsProvider(snsConfig, { client });

    await expect(notifySms(message, provider)).resolves.toMatchObject({
      status: "failed",
      retryable: true,
      httpStatus: 500,
    });
  });

  it("treats a network-level failure with no $metadata as retryable", async () => {
    const client = { send: vi.fn().mockRejectedValue(new Error("fetch failed")) };
    const provider = snsSmsProvider(snsConfig, { client });

    await expect(notifySms(message, provider)).resolves.toEqual({
      status: "failed",
      retryable: true,
      errorCode: "network_error",
      detail: "fetch failed",
    });
  });
});

describe("smsProviderFromEnvironment", () => {
  it("disables (not_configured) when credentials are absent", async () => {
    const provider = smsProviderFromEnvironment({});
    expect(await provider.send(message)).toEqual({ status: "not_configured" });
  });

  it("builds a live SNS provider when credentials are present", async () => {
    const client = { send: vi.fn().mockResolvedValue({ MessageId: "sns-env" }) };
    const provider = smsProviderFromEnvironment(
      {
        SNS_AWS_REGION: "us-east-1",
        SNS_AWS_ACCESS_KEY_ID: "AKIA_ENV",
        SNS_AWS_SECRET_ACCESS_KEY: "env-secret",
      },
      { client },
    );
    expect(await provider.send(message)).toEqual({ status: "sent", providerMessageId: "sns-env" });
  });
});
