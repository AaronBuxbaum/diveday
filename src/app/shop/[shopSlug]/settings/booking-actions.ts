"use server";

import { z } from "zod";
import { setShopPackingList } from "@/db/shops";
import { checkbox, text } from "@/features/form-parse";
import { defineAction, land } from "@/features/server-action";
import { SETTINGS_GATE } from "./action-gates";

const packingForm = z.object({ packingList: text(), packingLogbook: checkbox() });

export const savePackingAction = defineAction({
  gate: [SETTINGS_GATE],
  input: packingForm,
  async run({ db, shopId, path }, form) {
    const settings = path("settings");
    const packingList = form.packingList
      .split("\n")
      .map((item) => item.trim())
      .filter(Boolean);
    if (
      packingList.length < 1 ||
      packingList.length > 12 ||
      packingList.some((item) => item.length > 100)
    ) {
      return land(settings, "packing-invalid", { extra: { saved: "packing" } });
    }
    await setShopPackingList(db, shopId, packingList, form.packingLogbook);
    return land(settings, "packing-saved", { extra: { saved: "packing" } });
  },
});
