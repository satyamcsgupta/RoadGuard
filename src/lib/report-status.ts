export type ReportStatusPresentation = {
  label: string;
  description: string | null;
  textColor: string;
  backgroundColor: string;
  borderColor: string;
};

const reportStatusPresentations: Record<string, ReportStatusPresentation> = {
  submitted: {
    label: "🟡 Submitted",
    description: "Your report has been received and is waiting for review.",
    textColor: "#765A2D",
    backgroundColor: "#F8F1E3",
    borderColor: "#EADDBF",
  },
};

export function getReportStatusPresentation(
  status: string | null | undefined
): ReportStatusPresentation {
  if (!status) {
    return {
      label: "Status unavailable",
      description: null,
      textColor: "#66736A",
      backgroundColor: "#F0F3F1",
      borderColor: "#E2E9E4",
    };
  }

  return (
    reportStatusPresentations[status] ?? {
      label: status,
      description: null,
      textColor: "#66736A",
      backgroundColor: "#F0F3F1",
      borderColor: "#E2E9E4",
    }
  );
}
