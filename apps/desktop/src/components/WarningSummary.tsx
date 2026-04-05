import { memo } from "react";
import type { CleanupWarning } from "../lib/contracts";
import { formatWarningSeverity, type Locale } from "../lib/i18n";
import { groupWarningsBySeverity } from "../lib/warnings";

function summaryChipClass(severity: CleanupWarning["severity"]): string {
  switch (severity) {
    case "Critical":
      return "warning-summary-chip warning-summary-chip-critical";
    case "Attention":
      return "warning-summary-chip warning-summary-chip-attention";
    case "Info":
      return "warning-summary-chip warning-summary-chip-info";
  }
}

interface WarningSummaryProps {
  locale: Locale;
  warnings: CleanupWarning[];
  compact?: boolean;
  label?: string;
}

export const WarningSummary = memo(function WarningSummary({ locale, warnings, compact = false, label }: WarningSummaryProps): JSX.Element | null {
  const groups = groupWarningsBySeverity(warnings);
  if (groups.length === 0) {
    return null;
  }

  return (
    <div className={compact ? "warning-summary warning-summary-compact" : "warning-summary"}>
      {label ? <p className="warning-summary-label">{label}</p> : null}
      <div className="warning-summary-chips">
        {groups.map((group) => (
          <span key={group.severity} className={summaryChipClass(group.severity)}>
            <span>{formatWarningSeverity(locale, group.severity)}</span>
            <strong>{group.warnings.length}</strong>
          </span>
        ))}
      </div>
    </div>
  );
});
