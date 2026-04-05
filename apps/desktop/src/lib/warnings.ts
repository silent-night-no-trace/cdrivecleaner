import type { CleanupWarning, WarningSeverity } from "./contracts";

export interface WarningGroup {
  severity: WarningSeverity;
  warnings: CleanupWarning[];
}

const severityRank: Record<WarningSeverity, number> = {
  Critical: 0,
  Attention: 1,
  Info: 2,
};

export function sortWarnings(warnings: CleanupWarning[]): CleanupWarning[] {
  return [...warnings].sort((left, right) => {
    const severityOrder = severityRank[left.severity] - severityRank[right.severity];
    if (severityOrder !== 0) {
      return severityOrder;
    }
    return left.message.localeCompare(right.message);
  });
}

export function groupWarningsBySeverity(warnings: CleanupWarning[]): WarningGroup[] {
  const grouped = new Map<WarningSeverity, CleanupWarning[]>();

  for (const warning of sortWarnings(warnings)) {
    const existing = grouped.get(warning.severity);
    if (existing) {
      existing.push(warning);
    } else {
      grouped.set(warning.severity, [warning]);
    }
  }

  return [...grouped.entries()].map(([severity, items]) => ({
    severity,
    warnings: items,
  }));
}
