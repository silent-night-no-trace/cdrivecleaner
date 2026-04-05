import type { ExportArtifact, HistoryEntry } from "../lib/contracts";
import type { Locale } from "../lib/i18n";
import { formatHistorySummary, formatHistoryTimestamp, t } from "../lib/i18n";

interface HistoryPageProps {
  entries: HistoryEntry[];
  locale: Locale;
  exportStatus: "idle" | "loading" | "ready" | "error";
  exportArtifact: ExportArtifact | null;
  exportError: string | null;
  onExportHistory: () => void;
  actionsDisabled: boolean;
}

export function HistoryPage({ entries, locale, exportStatus, exportArtifact, exportError, onExportHistory, actionsDisabled }: HistoryPageProps): JSX.Element {
  return (
    <section className="page-shell">
      <div className="panel">
        <div className="results-toolbar">
          <h2>{t(locale, "historyTitle")}</h2>
          <button className="secondary-button" disabled={actionsDisabled || exportStatus === "loading"} onClick={onExportHistory} type="button">
            {exportStatus === "loading" ? t(locale, "exporting") : t(locale, "exportHistoryAction")}
          </button>
        </div>
        <p className="category-hint">{t(locale, "exportHistoryHint")}</p>
        {exportArtifact ? <p className="category-hint">{t(locale, "exportSavedTo").replace("{path}", exportArtifact.filePath)}</p> : null}
        {exportError ? <p className="error-copy">{exportError}</p> : null}
        {entries.length === 0 ? (
          <p>{t(locale, "historyEmpty")}</p>
        ) : (
          <ul className="history-list">
            {entries.map((entry) => (
              <li key={`${entry.timestamp}-${entry.kind}-${entry.summary}`} className="history-item">
                <div className="history-item-header">
                  <p className="eyebrow">{entry.kind === "scan" ? t(locale, "scanLabel") : t(locale, "cleanLabel")}</p>
                  {(entry.origin === "scheduled" || entry.summary.startsWith("Scheduled scan (")) ? <span className="chip-label chip-label-inactive">{t(locale, "historyScheduledBadge")}</span> : null}
                </div>
                <h3>{formatHistoryTimestamp(locale, entry.timestamp)}</h3>
                <p>{formatHistorySummary(locale, entry)}</p>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
