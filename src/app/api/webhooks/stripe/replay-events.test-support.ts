import { nowMs } from "@/lib/clock";

export function completedPaid(id: string, sessionId: string, amountTotal: number | null = null) {
  return {
    id,
    type: "checkout.session.completed",
    created: Math.floor(nowMs() / 1000),
    data: {
      object: {
        id: sessionId,
        payment_status: "paid",
        ...(amountTotal !== null ? { amount_total: amountTotal } : {}),
      },
    },
  };
}

export function completedUnpaid(id: string, sessionId: string) {
  return {
    id,
    type: "checkout.session.completed",
    created: Math.floor(nowMs() / 1000),
    data: { object: { id: sessionId, payment_status: "unpaid" } },
  };
}

export function asyncSucceeded(id: string, sessionId: string, amountTotal: number) {
  return {
    id,
    type: "checkout.session.async_payment_succeeded",
    created: Math.floor(nowMs() / 1000),
    data: { object: { id: sessionId, amount_total: amountTotal } },
  };
}

export function asyncFailed(id: string, sessionId: string) {
  return {
    id,
    type: "checkout.session.async_payment_failed",
    created: Math.floor(nowMs() / 1000),
    data: { object: { id: sessionId } },
  };
}

export function sessionExpired(id: string, sessionId: string) {
  return {
    id,
    type: "checkout.session.expired",
    created: Math.floor(nowMs() / 1000),
    data: { object: { id: sessionId } },
  };
}

export function invoicePaid(id: string, invoiceId: string, amountPaid: number) {
  return {
    id,
    type: "invoice.paid",
    created: Math.floor(nowMs() / 1000),
    data: { object: { id: invoiceId, amount_paid: amountPaid } },
  };
}

export function invoiceVoided(id: string, invoiceId: string) {
  return {
    id,
    type: "invoice.voided",
    created: Math.floor(nowMs() / 1000),
    data: { object: { id: invoiceId } },
  };
}
