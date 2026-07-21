export function NoticeBanner({ notice }: { notice?: string }) {
  const noticeText =
    notice === "captured"
      ? "Card captured as pending. Look the number up with the agency, then mark it certified before it can make this diver ready."
      : notice === "verified"
        ? "Card marked certified. It now counts toward readiness."
        : notice === "rejected"
          ? "Card marked for correction."
          : notice === "person-saved"
            ? "Diver details updated."
            : notice === "profile-saved"
              ? "Rental fit profile saved."
              : notice === "image"
                ? "That photo could not be used. Upload a JPG, PNG, or WebP under 5 MB."
                : notice === "duplicate"
                  ? "Another diver already uses that email in this shop."
                  : notice === "refunded"
                    ? "Payment refunded — the trip now shows as unpaid for this diver."
                    : notice === "booked"
                      ? "Activity booked. Review it below, then create and send the invoice."
                      : notice === "trip_full"
                        ? "That activity just filled up. Choose another."
                        : notice === "already_booked"
                          ? "This diver is already booked on that activity."
                          : notice === "course_unstaffed"
                            ? "Assign an instructor before booking this course."
                            : notice === "course_prerequisite"
                              ? "Mark the required certification certified before booking this course."
                              : notice === "trip_unavailable" || notice === "booking-invalid"
                                ? "Add an email and choose an available activity."
                                : notice === "refund-failed"
                                  ? "That payment could not be refunded. It may not be paid, or Stripe may need attention."
                                  : notice === "deleted"
                                    ? "Diver removed from active shop work. Their booking and card history is preserved."
                                    : notice === "invalid"
                                      ? "Check the details and try again."
                                      : null;
  const errorNotice = [
    "image",
    "duplicate",
    "refund-failed",
    "invalid",
    "trip_full",
    "already_booked",
    "course_unstaffed",
    "course_prerequisite",
    "trip_unavailable",
    "booking-invalid",
  ].includes(notice ?? "");

  if (!noticeText) return null;

  return (
    <p
      role="status"
      className={`mt-6 rounded-lg px-4 py-3 text-sm font-medium ${errorNotice ? "bg-danger/10 text-danger" : "bg-success/10 text-success"}`}
    >
      {noticeText}
    </p>
  );
}
