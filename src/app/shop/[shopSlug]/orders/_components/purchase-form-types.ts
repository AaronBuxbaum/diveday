import type { CustomerPickerWords } from "./CustomerPicker";

export type PurchaseRow = {
  id: number;
  kind: string;
  description: string;
  quantity: string;
  unitAmount: string;
};
export type PurchaseWords = {
  title: string;
  /** The customer picker's words; nobody chosen is a walk-in (issue #4601). */
  customer: CustomerPickerWords;
  method: string;
  reference: string;
  note: string;
  /** The "(optional)" hint on every box the payment can leave blank. */
  optional: string;
  item: string;
  kind: string;
  quantity: string;
  price: string;
  tax: string;
  taxHint: string;
  tip: string;
  gross: string;
  grossDue: string;
  add: string;
  remove: string;
  submit: string;
  busy: string;
  invalid: string;
  entryType: string;
  received: string;
  due: string;
  dueHelp: string;
  itemsHeading: string;
  paymentHeading: string;
  totalInvalid: string;
  submitDue: string;
  payerRequired: string;
  kinds: { value: string; label: string }[];
  methods: { value: string; label: string }[];
};
