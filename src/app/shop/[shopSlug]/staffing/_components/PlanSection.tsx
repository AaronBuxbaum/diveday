/**
 * One of the Shifts tab's two forms: a heading over the form, always
 * open, because the tab exists to fill them in.
 */
export function PlanSection({
  id,
  label,
  children,
}: {
  id: string;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <section aria-labelledby={`${id}-heading`} id={id} className="scroll-mt-8 pt-2 pb-8">
      <h2 id={`${id}-heading`} className="mb-4 font-semibold">
        {label}
      </h2>
      {children}
    </section>
  );
}
