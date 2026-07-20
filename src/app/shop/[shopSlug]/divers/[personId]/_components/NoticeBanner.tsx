export function NoticeBanner({ notice }: { notice?: string }) {
  const noticeText =
    notice === "captured"
      ? "Card captured as pending. Verify it before it can make this diver ready."
      : notice === "verified"
        ? "Certification verified."
        : notice === "rejected"
          ? "Card marked for correction."
          : notice === "person-saved"
            ? "Diver details updated."
            : notice === "profile-saved"
              ? "Rental fit profile saved."
              : notice === "image"
                ? "That photo could not be used. Upload a JPG, PNG, or WebP under 5 MB."
                : notice === "agency-verified"
                  ? "Confirmed with the agency and verified."
                  : notice === "agency-not-found"
                    ? "The agency could not find this card. It remains pending for manual review."
                    : notice === "agency-mismatch"
                      ? "The agency returned a mismatch. It remains pending for manual review."
                      : notice === "agency-unavailable"
                        ? "Agency verification is not configured. Verify this card manually."
                        : notice === "duplicate"
                          ? "Another diver already uses that email in this shop."
                          : notice === "refunded"
                            ? "Payment refunded and the diver's trip payment gate was reopened."
                            : notice === "booked"
                              ? "Activity booked. Review it below, then create and send the invoice."
                              : notice === "trip_full"
                                ? "That activity just filled up. Choose another."
                                : notice === "already_booked"
                                  ? "This diver is already booked on that activity."
                                  : notice === "course_unstaffed"
                                    ? "Assign an instructor before booking this course."
                                    : notice === "course_prerequisite"
                                      ? "Verify the required certification before booking this course."
                                      : notice === "trip_unavailable" ||
                                          notice === "booking-invalid"
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
    "agency-not-found",
    "agency-mismatch",
    "agency-unavailable",
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
