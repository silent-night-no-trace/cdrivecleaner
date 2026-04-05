import { memo } from "react";
import type { CleanupWarning } from "../lib/contracts";
import { formatWarningSeverity, t, type Locale } from "../lib/i18n";
import { groupWarningsBySeverity } from "../lib/warnings";

function warningGroupClass(severity: CleanupWarning["severity"]): string {
  switch (severity) {
    case "Critical":
      return "warning-group-critical";
    case "Attention":
      return "warning-group-attention";
    case "Info":
      return "warning-group-info";
  }
}

function warningSeverityIcon(severity: CleanupWarning["severity"]): string {
  switch (severity) {
    case "Critical":
      return "!";
    case "Attention":
      return "~";
    case "Info":
      return "i";
  }
}

interface WarningGroupsProps {
  locale: Locale;
  warnings: CleanupWarning[];
  emptyLabel?: string;
  compact?: boolean;
}

export const WarningGroups = memo(function WarningGroups({ locale, warnings, emptyLabel, compact = false }: WarningGroupsProps): JSX.Element {
  if (warnings.length === 0) {
    return <p>{emptyLabel ?? t(locale, "noWarnings")}</p>;
  }

  return (
    <div className={compact ? "warning-groups warning-groups-compact" : "warning-groups"}>
      {groupWarningsBySeverity(warnings).map((group) => (
        <section key={group.severity} className={`warning-group ${warningGroupClass(group.severity)}`}>
          <div className="warning-group-header">
            <p className="warning-group-title">
              <span className="warning-group-icon">{warningSeverityIcon(group.severity)}</span>
              {formatWarningSeverity(locale, group.severity)}
            </p>
            <span className="warning-group-count">{group.warnings.length}</span>
          </div>
          <ul className="warning-list">
            {group.warnings.map((warning) => (
              <li key={`${warning.code}-${warning.message}`} className="warning-item">
                {warning.message}
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
});
