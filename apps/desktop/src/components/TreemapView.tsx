import { useMemo, useState } from "react";
import type { Locale } from "../lib/i18n";
import { formatBytes } from "../lib/formatBytes";
import { formatWarningSeverity, t } from "../lib/i18n";
import type { TreemapBlock } from "../lib/fullScanTree";

function severityChipClass(severity: "Critical" | "Attention" | "Info"): string {
  switch (severity) {
    case "Critical":
      return "warning-summary-chip warning-summary-chip-critical treemap-severity-chip";
    case "Attention":
      return "warning-summary-chip warning-summary-chip-attention treemap-severity-chip";
    case "Info":
      return "warning-summary-chip warning-summary-chip-info treemap-severity-chip";
  }
}

interface TreemapViewProps {
  locale: Locale;
  blocks: TreemapBlock[];
  onSelectNode: (path: string) => void;
  actionsDisabled: boolean;
}

export function TreemapView({ locale, blocks, onSelectNode, actionsDisabled }: TreemapViewProps): JSX.Element {
  const [hoveredPath, setHoveredPath] = useState<string | null>(null);
  const hoveredBlock = useMemo(
    () => blocks.find((block) => block.path === hoveredPath) ?? null,
    [blocks, hoveredPath],
  );

  if (blocks.length === 0) {
    return <p className="tree-largest-empty">{t(locale, "treemapEmpty")}</p>;
  }

  return (
    <div className="treemap-shell">
      <div className="treemap-grid" role="list" aria-label={t(locale, "treemapTitle")}>
        {blocks.map((block) => (
          <div key={block.path} role="listitem" style={{ gridColumn: `span ${Math.min(block.columnSpan, 6)}` }}>
            <button
              aria-label={`${block.label} ${formatBytes(block.sizeBytes, locale)} ${Math.round(block.share * 100)}%`}
              className={block.isDirectory ? "treemap-tile treemap-tile-directory" : "treemap-tile treemap-tile-file"}
              disabled={actionsDisabled}
              onBlur={() => setHoveredPath((current) => (current === block.path ? null : current))}
              onClick={() => onSelectNode(block.path)}
              onFocus={() => setHoveredPath(block.path)}
              onMouseEnter={() => setHoveredPath(block.path)}
              onMouseLeave={() => setHoveredPath((current) => (current === block.path ? null : current))}
              type="button"
            >
              <span className="treemap-tile-topline">
                <strong>{block.label}</strong>
                {block.isLazy ? <span className="tree-node-badge">{t(locale, "treeNodeLazyBadge")}</span> : null}
              </span>
              <span className="treemap-tile-meta">{formatBytes(block.sizeBytes, locale)} · {Math.round(block.share * 100)}%</span>
              {block.warningCount > 0 ? <span className="treemap-tile-meta">{t(locale, "treemapTileWarningHint")}: {block.warningCount}</span> : null}
              {block.warningCount > 0 ? (
                <span className="treemap-severity-row">
                  {(["Critical", "Attention", "Info"] as const)
                    .filter((severity) => block.warningBreakdown[severity] > 0)
                    .map((severity) => (
                      <span key={severity} className={severityChipClass(severity)}>
                        <span>{formatWarningSeverity(locale, severity)}</span>
                        <strong>{block.warningBreakdown[severity]}</strong>
                      </span>
                    ))}
                </span>
              ) : null}
            </button>
          </div>
        ))}
      </div>
      <div className="treemap-hover-card">
        {hoveredBlock ? (
          <>
            <div className="treemap-hover-header">
              <strong>{hoveredBlock.label}</strong>
              <span className="warning-summary-label">{t(locale, hoveredBlock.isDirectory ? "directoryType" : "fileType")}</span>
            </div>
            <p className="treemap-hover-path">{hoveredBlock.path}</p>
            <div className="treemap-hover-grid">
              <div className="summary-card">
                <span>{t(locale, "treemapSizeLabel")}</span>
                <strong>{formatBytes(hoveredBlock.sizeBytes, locale)}</strong>
              </div>
              <div className="summary-card">
                <span>{t(locale, "treemapShareLabel")}</span>
                <strong>{Math.round(hoveredBlock.share * 100)}%</strong>
              </div>
              <div className="summary-card">
                <span>{t(locale, "loadedWarningsLabel")}</span>
                <strong>{hoveredBlock.warningCount}</strong>
              </div>
              <div className="summary-card">
                <span>{t(locale, "loadedDescendantsLabel")}</span>
                <strong>{hoveredBlock.loadedDescendants}</strong>
              </div>
              <div className="summary-card">
                <span>{t(locale, "treemapLazyCountLabel")}</span>
                <strong>{hoveredBlock.lazyDescendantCount}</strong>
              </div>
            </div>
            {hoveredBlock.warningCount > 0 ? (
              <div className="warning-summary warning-summary-compact treemap-warning-breakdown">
                <p className="warning-summary-label">{t(locale, "treemapWarningBreakdownLabel")}</p>
                <div className="warning-summary-chips">
                  {(["Critical", "Attention", "Info"] as const)
                    .filter((severity) => hoveredBlock.warningBreakdown[severity] > 0)
                    .map((severity) => (
                      <span key={severity} className={severityChipClass(severity)}>
                        <span>{formatWarningSeverity(locale, severity)}</span>
                        <strong>{hoveredBlock.warningBreakdown[severity]}</strong>
                      </span>
                    ))}
                </div>
              </div>
            ) : null}
            <p className="category-hint">{hoveredBlock.isDirectory ? t(locale, "treemapDrillHint") : t(locale, "treemapFocusHint")}</p>
            {hoveredBlock.isLazy ? <p className="category-hint">{t(locale, "treemapLazyHint")}</p> : null}
          </>
        ) : (
          <p className="category-hint">{t(locale, "treemapHoverPrompt")}</p>
        )}
      </div>
    </div>
  );
}
