import { describe, expect, it } from "vitest";
import { parseSmsReply } from "./sms-replies";

function inbound(messageBody: string, originationNumber = "+13055550134"): string {
  return JSON.stringify({
    originationNumber,
    destinationNumber: "+18335550100",
    messageKeyword: "KEYWORD_123456789012",
    messageBody,
    inboundMessageId: "cae173d2-66b9-564c-8309-21f858e9fb84",
    previousPublishedMessageId: "wJ0hVTaUbHPk9Ff0yaMw",
  });
}

describe("parseSmsReply", () => {
  it.each(["STOP", "stop", " Stop. ", "unsubscribe", "CANCEL", "end", "quit", "STOPALL", "optout"])(
    "reads %j as an opt-out",
    (body) => {
      expect(parseSmsReply(inbound(body))).toEqual({ kind: "stop", phone: "+13055550134" });
    },
  );

  it.each(["START", "unstop", "Start!"])("reads %j as an opt-in", (body) => {
    expect(parseSmsReply(inbound(body))).toEqual({ kind: "start", phone: "+13055550134" });
  });

  it("does not treat a sentence that starts with stop as an opt-out", () => {
    expect(parseSmsReply(inbound("Stop by the shop at 7?"))).toEqual({ kind: "ignored" });
  });

  it.each(["LATE", "late.", "Running late", "tarde"])("reads %j as running late (J3)", (body) => {
    expect(parseSmsReply(inbound(body))).toEqual({ kind: "late", phone: "+13055550134" });
  });

  it("does not read a sentence about lateness as LATE", () => {
    expect(parseSmsReply(inbound("Running late, there by 8"))).toEqual({ kind: "ignored" });
  });

  it("leaves HELP to the reply AWS sends from the number", () => {
    expect(parseSmsReply(inbound("HELP"))).toEqual({ kind: "ignored" });
  });

  it("normalizes the sender's number to the form texts are sent to", () => {
    expect(parseSmsReply(inbound("STOP", "+1 (305) 555-0134"))).toEqual({
      kind: "stop",
      phone: "+13055550134",
    });
  });

  it("ignores a sender that is not a dialable E.164 number", () => {
    expect(parseSmsReply(inbound("STOP", "12345"))).toEqual({ kind: "ignored" });
  });

  it("ignores a delivery receipt on the same topic", () => {
    const receipt = JSON.stringify({
      notification: { messageId: "abc", timestamp: "2026-10-07 00:00:00.000" },
      delivery: { destination: "+13055550134" },
      status: "SUCCESS",
    });
    expect(parseSmsReply(receipt)).toEqual({ kind: "ignored" });
  });

  it("ignores a body that is not JSON", () => {
    expect(parseSmsReply("STOP")).toEqual({ kind: "ignored" });
  });
});
