"use client";

import { useRouter } from "next/navigation";
import { createContext, type ReactNode, useContext, useEffect, useRef, useState } from "react";
import { LiveRefresh } from "@/components/LiveRefresh";
import { buttonClass } from "@/components/ui/button";
import { Modal } from "@/components/ui/Modal";
import { fill } from "@/i18n/fill";

type QrResult = { ok: true; qr: string } | { ok: false };
type Copy = {
  show: string;
  showFor: string;
  title: string;
  scan: string;
  close: string;
  loading: string;
  failed: string;
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
  action: (bookingId: string) => Promise<QrResult>;
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
  const show = (selection: Selection) => {
    const current = ++generation.current;
    setSelected(selection);
    setResult(null);
    void action(selection.bookingId)
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
        <CourseFormsQrDialog selected={selected} result={result} copy={copy} onClose={close} />
      ) : null}
    </QrContext.Provider>
  );
}

function CourseFormsQrDialog({
  selected,
  result,
  copy,
  onClose,
}: {
  selected: Selection;
  result: QrResult | null;
  copy: Copy;
  onClose: () => void;
}) {
  const router = useRouter();
  const close = () => {
    onClose();
    router.refresh();
  };
  return (
    <Modal open onClose={close} title={copy.title} className="print:hidden">
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
    </Modal>
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
