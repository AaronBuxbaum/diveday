"use client";

import { useEffect } from "react";
import { forgetThisDevice } from "./forget-device";

/** Mounted on the sign-in page: whoever signs in next starts with nothing kept. */
export function ForgetThisDevice() {
  useEffect(() => {
    void forgetThisDevice();
  }, []);
  return null;
}
