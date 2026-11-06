"use client";

import { useRouter } from "next/navigation";
import { createContext, type ReactNode, useContext, useEffect, useRef, useState } from "react";
import { LiveRefresh } from "@/components/LiveRefresh";
import { buttonClass } from "@/components/ui/button";
import { Dialog } from "@/components/ui/layer";
import { fill } from "@/i18n/fill";

type QrResult = { ok: true; qr: string } | { ok: false; openOnPhone?: true };
type Copy = {
  show: string;
  showFor: string;
  title: string;
  scan: string;
  close: string;
  loading: string;
  failed: string;
  /** A code already open on the person's phone, and the desk's way to replace it. */
  openOnPhone?: string;
  replace?: string;
};
type Selection = { bookingId: string; name: string };
const QrContext = createContext<null | {
  show: (selection: Selection) => void;
  label: string;
  labelFor: string;
}>(null);

/** One dialog owns the credential, so switching or closing destroys the previous image. */
export function CourseFormsQrProvider({
  children,
  action,
  copy,
}: {
  children: ReactNode;
  action: (bookingId: string, replace?: boolean) => Promise<QrResult>;
  copy: Copy;
}) {
  const [selected, setSelected] = useState<Selection | null>(null);
  const [result, setResult] = useState<QrResult | null>(null);
  const [monitoring, setMonitoring] = useState(false);
  const generation = useRef(0);
  useEffect(
    () => () => {
      generation.current++;
    },
    [],
  );
  const close = () => {
    generation.current++;
    setResult(null);
    setSelected(null);
  };
  const show = (selection: Selection, replace = false) => {
    const current = ++generation.current;
    setSelected(selection);
    setResult(null);
    void action(selection.bookingId, replace)
      .then((next) => {
        if (generation.current === current) {
          setResult(next);
          if (next.ok) setMonitoring(true);
        }
      })
      .catch(() => {
        if (generation.current === current) setResult({ ok: false });
      });
  };
  return (
    <QrContext.Provider value={{ show, label: copy.show, labelFor: copy.showFor }}>
      {children}
      {monitoring ? <LiveRefresh holdAfterTapMs={5000} /> : null}
      {selected ? (
        <CourseFormsQrDialog
          selected={selected}
          result={result}
          copy={copy}
          onClose={close}
          onReplace={() => show(selected, true)}
        />
      ) : null}
    </QrContext.Provider>
  );
}

function CourseFormsQrDialog({
  selected,
  result,
  copy,
  onClose,
  onReplace,
}: {
  selected: Selection;
  result: QrResult | null;
  copy: Copy;
  onClose: () => void;
  onReplace: () => void;
}) {
  const router = useRouter();
  const close = () => {
    onClose();
    router.refresh();
  };
  return (
    <Dialog open onClose={close} title={copy.title} className="print:hidden">
      <p className="font-semibold">{selected.name}</p>
      <p className="mt-2">{copy.scan}</p>
      {result === null ? (
        <p role="status" className="mt-4">
          {copy.loading}
        </p>
      ) : result.ok ? (
        // biome-ignore lint/performance/noImgElement: local data URL, never a remote image.
        <img
          src={result.qr}
          alt={copy.title}
          width={256}
          height={256}
          className="mt-4 size-64 max-w-full"
        />
      ) : result.openOnPhone && copy.openOnPhone && copy.replace ? (
        // Never a silent replace: the person may be halfway through (dock review S2).
        <div className="mt-4">
          <p role="status">{copy.openOnPhone}</p>
          <button
            type="button"
            onClick={onReplace}
            className={buttonClass({ variant: "secondary", className: "mt-3" })}
          >
            {copy.replace}
          </button>
        </div>
      ) : (
        <p role="alert" className="mt-4">
          {copy.failed}
        </p>
      )}
      <button
        type="button"
        onClick={close}
        className={buttonClass({ variant: "secondary", className: "mt-4" })}
      >
        {copy.close}
      </button>
    </Dialog>
  );
}

export function CourseFormsQrButton({ bookingId, name }: Selection) {
  const context = useContext(QrContext);
  if (!context) return null;
  return (
    <button
      type="button"
      aria-label={fill(context.labelFor, { name })}
      onClick={() => context.show({ bookingId, name })}
      className={buttonClass({ variant: "secondary" })}
    >
      {context.label}
    </button>
  );
}
