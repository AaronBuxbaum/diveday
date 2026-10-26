"use client";

import { useState, useTransition } from "react";
import { FormStatus } from "@/components/ui/form";
import { Switch } from "@/components/ui/Switch";

export function EmailPreferenceSwitch({
  wanted,
  label,
  saving,
  failed,
  save,
}: {
  wanted: boolean;
  label: string;
  saving: string;
  failed: string;
  save: (wanted: boolean) => Promise<void>;
}) {
  const [confirmed, setConfirmed] = useState(wanted);
  const [error, setError] = useState(false);
  const [pending, startTransition] = useTransition();
  function change(next: boolean) {
    if (pending) return;
    setError(false);
    startTransition(async () => {
      try {
        await save(next);
        setConfirmed(next);
      } catch {
        setError(true);
      }
    });
  }
  return (
    <div className="contents">
      <Switch
        checked={confirmed}
        onChange={change}
        label={<span className="sr-only">{label}</span>}
        className="border-transparent bg-transparent p-0"
        busy={pending}
      />
      {pending ? (
        <p role="status" className="col-span-full text-sm text-muted">
          {saving}
        </p>
      ) : null}
      {error ? (
        <FormStatus tone="danger" className="col-span-full">
          {failed}
        </FormStatus>
      ) : null}
    </div>
  );
}
