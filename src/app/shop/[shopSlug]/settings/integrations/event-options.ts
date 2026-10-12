/** The order events a webhook connector (Zapier) can subscribe to, each with its words. */
export const EVENT_OPTIONS = [
  { value: "order.created", label: "integrations.common.orderCreated" },
  { value: "order.paid", label: "integrations.common.orderPaid" },
  { value: "order.refunded", label: "integrations.common.orderRefunded" },
  { value: "order.voided", label: "integrations.common.orderVoided" },
] as const;

export type EventLabelKey = (typeof EVENT_OPTIONS)[number]["label"];
