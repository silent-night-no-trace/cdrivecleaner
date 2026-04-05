import { memo, startTransition, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { WarningGroups } from "./WarningGroups";
import { WarningSummary } from "./WarningSummary";
import type { FullScanTreeNode } from "../lib/contracts";
import { formatBytes } from "../lib/formatBytes";
import { t, type Locale } from "../lib/i18n";

interface FileTreeViewProps {
  locale: Locale;
  root: FullScanTreeNode;
  onExpandNode: (path: string) => Promise<void>;
  onSelectNode: (path: string) => void;
  onToggleDeletePath: (path: string) => void;
  selectedPath: string | null;
  selectedNodeChildrenLoaded: boolean;
  selectedDeletePathSet: ReadonlySet<string>;
  rootPath: string;
  selectedTrailPathSet: ReadonlySet<string>;
  interactionDisabled?: boolean;
  forceExpandAll?: boolean;
  virtualizationViewportHeightPx?: number;
}

interface TreeNodeProps {
  locale: Locale;
  node: FullScanTreeNode;
  depth: number;
  expandedPaths: Set<string>;
  loadingPaths: Set<string>;
  togglePath: (path: string) => void;
  onExpandNode: (path: string) => Promise<void>;
  onSelectNode: (path: string) => void;
  onToggleDeletePath: (path: string) => void;
  selectedPath: string | null;
  selectedDeletePathSet: ReadonlySet<string>;
  rootPath: string;
  selectedTrailPathSet: ReadonlySet<string>;
  interactionDisabled: boolean;
  forceExpandAll: boolean;
  registerLabelRef: (path: string, element: HTMLButtonElement | null) => void;
}

interface VisibleTreeNode {
  node: FullScanTreeNode;
  depth: number;
}

interface VisibleTreeState {
  visibleNodes: VisibleTreeNode[];
  indexByPath: Map<string, number>;
  nodeByPath: Map<string, FullScanTreeNode>;
}

const TREE_VIRTUALIZATION_THRESHOLD = 160;
const TREE_VIEWPORT_HEIGHT_PX = 520;
const TREE_ROW_ESTIMATED_HEIGHT_PX = 56;
const TREE_WARNING_ESTIMATED_HEIGHT_PX = 40;
const TREE_VIRTUALIZATION_OVERSCAN = 8;

interface TreeNodeRowProps {
  locale: Locale;
  node: FullScanTreeNode;
  depth: number;
  rootPath: string;
  interactionDisabled: boolean;
  isExpanded: boolean;
  isLoading: boolean;
  isSelected: boolean;
  isInSelectedTrail: boolean;
  isDeleteSelected: boolean;
  forceExpandAll: boolean;
  onToggleDeletePath: (path: string) => void;
  onSelectNode: (path: string) => void;
  onDirectoryLabelClick: (path: string) => Promise<void> | void;
  onTogglePath: (path: string) => Promise<void> | void;
  registerLabelRef: (path: string, element: HTMLButtonElement | null) => void;
}

const TreeNodeRow = memo(function TreeNodeRow({ locale, node, depth, rootPath, interactionDisabled, isExpanded, isLoading, isSelected, isInSelectedTrail, isDeleteSelected, forceExpandAll, onToggleDeletePath, onSelectNode, onDirectoryLabelClick, onTogglePath, registerLabelRef }: TreeNodeRowProps): JSX.Element {
  const hasChildren = node.isDirectory && node.hasChildren;
  const toggleDisabled = interactionDisabled || isLoading || (forceExpandAll && node.childrenLoaded);
  const deleteDisabled = interactionDisabled || node.path === rootPath;
  const rowClassName = [
    "tree-node-row",
    isSelected ? "tree-node-row-selected" : "",
    !isSelected && isInSelectedTrail ? "tree-node-row-trail" : "",
  ]
    .filter(Boolean)
    .join(" ");

  const toggleLabel = forceExpandAll && node.childrenLoaded
    ? t(locale, "treeExpandedWhileFiltering").replace("{name}", node.name)
    : t(locale, isExpanded ? "treeCollapseNode" : "treeExpandNode").replace("{name}", node.name);

  return (
    <div className={rowClassName} style={{ paddingLeft: `${depth * 16}px` }}>
      <input aria-label={t(locale, "treeSelectForDeletion").replace("{name}", node.name)} checked={isDeleteSelected} className="tree-checkbox" disabled={deleteDisabled} onChange={() => onToggleDeletePath(node.path)} type="checkbox" />
      {node.isDirectory ? (
        <button aria-label={toggleLabel} className="tree-toggle" disabled={toggleDisabled} onClick={() => void onTogglePath(node.path)} type="button">
          {isLoading ? "…" : hasChildren ? (isExpanded ? "▾" : "▸") : "•"}
        </button>
      ) : (
        <span className="tree-toggle tree-toggle-placeholder">•</span>
      )}
      {node.isDirectory ? (
        <button className={isSelected ? "tree-node-label tree-node-label-selected" : "tree-node-label"} disabled={interactionDisabled} onClick={() => void onDirectoryLabelClick(node.path)} ref={(element) => registerLabelRef(node.path, element)} type="button">
          {node.name}/
        </button>
      ) : (
        <button className={isSelected ? "tree-node-label tree-node-label-selected" : "tree-node-label"} disabled={interactionDisabled} onClick={() => onSelectNode(node.path)} ref={(element) => registerLabelRef(node.path, element)} type="button">
          {node.name}
        </button>
      )}
      {node.warnings.length > 0 || (node.isDirectory && node.hasChildren && !node.childrenLoaded) ? (
        <div className="tree-node-meta">
          <WarningSummary compact locale={locale} warnings={node.warnings} />
          {node.isDirectory && node.hasChildren && !node.childrenLoaded ? <span className="tree-node-badge">{t(locale, "treeNodeLazyBadge")}</span> : null}
        </div>
      ) : null}
      <span className="tree-node-size">{formatBytes(node.sizeBytes, locale)}</span>
    </div>
  );
}, (previous, next) => {
  return previous.node === next.node
    && previous.depth === next.depth
    && previous.locale === next.locale
    && previous.rootPath === next.rootPath
    && previous.interactionDisabled === next.interactionDisabled
    && previous.forceExpandAll === next.forceExpandAll
    && previous.isExpanded === next.isExpanded
    && previous.isLoading === next.isLoading
    && previous.isSelected === next.isSelected
    && previous.isInSelectedTrail === next.isInSelectedTrail
    && previous.isDeleteSelected === next.isDeleteSelected
    && previous.onTogglePath === next.onTogglePath
    && previous.onSelectNode === next.onSelectNode
    && previous.onDirectoryLabelClick === next.onDirectoryLabelClick
    && previous.onToggleDeletePath === next.onToggleDeletePath
    && previous.registerLabelRef === next.registerLabelRef;
});

function buildVisibleTreeState(root: FullScanTreeNode, expandedPaths: ReadonlySet<string>, forceExpandAll: boolean): VisibleTreeState {
  const visibleNodes: VisibleTreeNode[] = [];
  const indexByPath = new Map<string, number>();
  const nodeByPath = new Map<string, FullScanTreeNode>();
  const stack: Array<{ node: FullScanTreeNode; depth: number }> = [{ node: root, depth: 0 }];

  while (stack.length > 0) {
    const current = stack.pop();
    if (!current) {
      continue;
    }

    const { node, depth } = current;
    indexByPath.set(node.path, visibleNodes.length);
    visibleNodes.push({ node, depth });
    nodeByPath.set(node.path, node);
    if (!node.isDirectory) {
      continue;
    }
    if (!forceExpandAll && !expandedPaths.has(node.path)) {
      continue;
    }
    for (let index = node.children.length - 1; index >= 0; index -= 1) {
      const child = node.children[index];
      if (!child) {
        continue;
      }
      stack.push({ node: child, depth: depth + 1 });
    }
  }

  return { visibleNodes, indexByPath, nodeByPath };
}

function estimateTreeItemHeight(node: FullScanTreeNode): number {
  return TREE_ROW_ESTIMATED_HEIGHT_PX + (node.warnings.length > 0 ? TREE_WARNING_ESTIMATED_HEIGHT_PX : 0);
}

function findVisibleStartIndex(offsets: readonly number[], value: number): number {
  let low = 0;
  let high = offsets.length - 1;

  while (low <= high) {
    const middle = Math.floor((low + high) / 2);
    const current = offsets[middle] ?? 0;
    const next = offsets[middle + 1] ?? Number.POSITIVE_INFINITY;
    if (value < current) {
      high = middle - 1;
      continue;
    }
    if (value >= next) {
      low = middle + 1;
      continue;
    }
    return middle;
  }

  return Math.max(0, Math.min(offsets.length - 1, low));
}

export function FileTreeView({ locale, root, onExpandNode, onSelectNode, onToggleDeletePath, selectedPath, selectedNodeChildrenLoaded, selectedDeletePathSet, rootPath, selectedTrailPathSet, interactionDisabled = false, forceExpandAll = false, virtualizationViewportHeightPx = TREE_VIEWPORT_HEIGHT_PX }: FileTreeViewProps): JSX.Element {
  const [expandedPaths, setExpandedPaths] = useState<Set<string>>(() => new Set<string>([root.path]));
  const [loadingPaths, setLoadingPaths] = useState<Set<string>>(new Set());
  const [scrollTop, setScrollTop] = useState(0);
  const inFlightExpansionPaths = useRef(new Set<string>());
  const latestCallbacksRef = useRef({ onExpandNode, onSelectNode, onToggleDeletePath });
  const labelRefs = useRef(new Map<string, HTMLButtonElement>());
  const expandedPathsRef = useRef(expandedPaths);
  const scrollContainerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    latestCallbacksRef.current = { onExpandNode, onSelectNode, onToggleDeletePath };
  }, [onExpandNode, onSelectNode, onToggleDeletePath]);

  useEffect(() => {
    expandedPathsRef.current = expandedPaths;
  }, [expandedPaths]);

  useEffect(() => {
    setExpandedPaths((previous) => (previous.has(root.path) ? previous : new Set(previous).add(root.path)));
  }, [root.path]);

  useEffect(() => {
    startTransition(() => {
      setExpandedPaths((previous) => {
        let changed = false;
        const next = new Set(previous);
        for (const path of selectedTrailPathSet) {
          if (path === selectedPath && !selectedNodeChildrenLoaded) {
            continue;
          }
          if (!next.has(path)) {
            next.add(path);
            changed = true;
          }
        }
        return changed ? next : previous;
      });
    });
  }, [selectedNodeChildrenLoaded, selectedPath, selectedTrailPathSet]);

  useEffect(() => {
    if (!selectedPath) {
      return;
    }
    const label = labelRefs.current.get(selectedPath);
    if (label && typeof label.scrollIntoView === "function") {
      label.scrollIntoView({ block: "nearest" });
      return;
    }
    const targetIndex = visibleTreeStateRef.current.indexByPath.get(selectedPath);
    if (targetIndex === undefined || !shouldVirtualizeRef.current || !scrollContainerRef.current) {
      return;
    }
    const targetOffset = visibleNodeOffsetsRef.current[targetIndex] ?? 0;
    scrollContainerRef.current.scrollTop = Math.max(0, targetOffset - Math.floor(virtualizationViewportHeightPx / 3));
    setScrollTop(scrollContainerRef.current.scrollTop);
  }, [selectedPath]);

  const registerLabelRef = useCallback((path: string, element: HTMLButtonElement | null) => {
    if (element) {
      labelRefs.current.set(path, element);
      return;
    }
    labelRefs.current.delete(path);
  }, []);

  const togglePath = useCallback((path: string) => {
    startTransition(() => {
      setExpandedPaths((previous) => {
        const next = new Set(previous);
        if (next.has(path)) {
          next.delete(path);
        } else {
          next.add(path);
        }
        return next;
      });
    });
  }, []);

  const expandPath = useCallback((path: string) => {
    startTransition(() => {
      setExpandedPaths((previous) => {
        if (previous.has(path)) {
          return previous;
        }
        const next = new Set(previous);
        next.add(path);
        return next;
      });
    });
  }, []);

  const handleExpandNode = useCallback(async (path: string) => {
    if (inFlightExpansionPaths.current.has(path)) {
      return false;
    }

    inFlightExpansionPaths.current.add(path);
    setLoadingPaths((previous) => new Set(previous).add(path));
    try {
      await latestCallbacksRef.current.onExpandNode(path);
      return true;
    } catch {
      return false;
    } finally {
      inFlightExpansionPaths.current.delete(path);
      setLoadingPaths((previous) => {
        const next = new Set(previous);
        next.delete(path);
        return next;
      });
    }
  }, []);

  const handleSelectNode = useCallback((path: string) => {
    latestCallbacksRef.current.onSelectNode(path);
  }, []);

  const handleToggleDeletePath = useCallback((path: string) => {
    latestCallbacksRef.current.onToggleDeletePath(path);
  }, []);

  const handleTogglePath = useCallback(async (path: string) => {
    const node = visibleNodesRef.current.get(path);
    if (!node) {
      return;
    }

    const isLoading = loadingPathsRef.current.has(path);
    if (interactionDisabled || isLoading || (forceExpandAll && node.childrenLoaded)) {
      return;
    }

    if (node.isDirectory && node.hasChildren && !node.childrenLoaded) {
      const didLoad = await handleExpandNode(path);
      if (!didLoad) {
        return;
      }
    }

    if (forceExpandAll) {
      return;
    }

    togglePath(path);
  }, [forceExpandAll, handleExpandNode, interactionDisabled, togglePath]);

  const handleDirectoryLabelClick = useCallback(async (path: string) => {
    latestCallbacksRef.current.onSelectNode(path);
    const node = visibleNodesRef.current.get(path);
    if (!node || !node.isDirectory) {
      return;
    }

    const isExpanded = forceExpandAll || expandedPathsRef.current.has(path);
    if (!node.childrenLoaded) {
      const didLoad = await handleExpandNode(path);
      if (!didLoad) {
        return;
      }
      expandPath(path);
      return;
    }

    if (!isExpanded && node.hasChildren) {
      expandPath(path);
    }
  }, [expandPath, forceExpandAll, handleExpandNode]);

  const visibleTreeState = useMemo(
    () => buildVisibleTreeState(root, expandedPaths, forceExpandAll),
    [expandedPaths, forceExpandAll, root],
  );
  const visibleNodes = visibleTreeState.visibleNodes;
  const visibleTreeStateRef = useRef(visibleTreeState);
  const visibleNodesRef = useRef(new Map<string, FullScanTreeNode>());
  const visibleNodeOffsetsRef = useRef<number[]>([]);
  const shouldVirtualizeRef = useRef(false);
  const loadingPathsRef = useRef(loadingPaths);

  const virtualLayout = useMemo(() => {
    const offsets: number[] = new Array(visibleNodes.length);
    let totalHeight = 0;
    for (let index = 0; index < visibleNodes.length; index += 1) {
      offsets[index] = totalHeight;
      totalHeight += estimateTreeItemHeight(visibleNodes[index]!.node);
    }

    const shouldVirtualize = visibleNodes.length >= TREE_VIRTUALIZATION_THRESHOLD;
    if (!shouldVirtualize) {
      return {
        shouldVirtualize,
        totalHeight,
        offsets,
        startIndex: 0,
        endIndex: visibleNodes.length,
        topSpacerHeight: 0,
        bottomSpacerHeight: 0,
      };
    }

    const startIndex = Math.max(0, findVisibleStartIndex(offsets, scrollTop) - TREE_VIRTUALIZATION_OVERSCAN);
    const endBoundary = scrollTop + virtualizationViewportHeightPx;
    const endIndex = Math.min(
      visibleNodes.length,
      findVisibleStartIndex(offsets, Math.max(0, endBoundary - 1)) + TREE_VIRTUALIZATION_OVERSCAN + 1,
    );
    const topSpacerHeight = offsets[startIndex] ?? 0;
    const bottomSpacerHeight = Math.max(0, totalHeight - (offsets[endIndex] ?? totalHeight));

    return {
      shouldVirtualize,
      totalHeight,
      offsets,
      startIndex,
      endIndex,
      topSpacerHeight,
      bottomSpacerHeight,
    };
  }, [scrollTop, virtualizationViewportHeightPx, visibleNodes]);

  const renderedNodes = useMemo(
    () => visibleNodes.slice(virtualLayout.startIndex, virtualLayout.endIndex),
    [virtualLayout.endIndex, virtualLayout.startIndex, visibleNodes],
  );

  useEffect(() => {
    visibleNodesRef.current = visibleTreeState.nodeByPath;
    visibleTreeStateRef.current = visibleTreeState;
    visibleNodeOffsetsRef.current = virtualLayout.offsets;
    shouldVirtualizeRef.current = virtualLayout.shouldVirtualize;
  }, [virtualLayout.offsets, virtualLayout.shouldVirtualize, visibleTreeState]);

  useEffect(() => {
    loadingPathsRef.current = loadingPaths;
  }, [loadingPaths]);

  useEffect(() => {
    if (!virtualLayout.shouldVirtualize && scrollTop !== 0) {
      setScrollTop(0);
    }
  }, [scrollTop, virtualLayout.shouldVirtualize]);

  return (
    <div
      className="tree-view"
      data-testid="tree-scroll-region"
      onScroll={virtualLayout.shouldVirtualize ? (event) => setScrollTop(event.currentTarget.scrollTop) : undefined}
      ref={scrollContainerRef}
      style={virtualLayout.shouldVirtualize ? { maxHeight: `${virtualizationViewportHeightPx}px`, overflowY: "auto" } : undefined}
    >
      <ul className="tree-root-list">
        {virtualLayout.topSpacerHeight > 0 ? <li aria-hidden="true" className="tree-virtual-spacer" style={{ height: `${virtualLayout.topSpacerHeight}px` }} /> : null}
        {renderedNodes.map(({ node, depth }) => {
          const isExpanded = forceExpandAll || expandedPaths.has(node.path);
          const isLoading = loadingPaths.has(node.path);
          const isSelected = selectedPath === node.path;
          const isInSelectedTrail = selectedTrailPathSet.has(node.path);
          const isDeleteSelected = selectedDeletePathSet.has(node.path);

          return (
            <li key={node.path} className="tree-node-item">
              <TreeNodeRow
                locale={locale}
                node={node}
                depth={depth}
                rootPath={rootPath}
                interactionDisabled={interactionDisabled}
                isExpanded={isExpanded}
                isLoading={isLoading}
                isSelected={isSelected}
                isInSelectedTrail={isInSelectedTrail}
                isDeleteSelected={isDeleteSelected}
                forceExpandAll={forceExpandAll}
                onToggleDeletePath={handleToggleDeletePath}
                onSelectNode={handleSelectNode}
                onDirectoryLabelClick={handleDirectoryLabelClick}
                onTogglePath={handleTogglePath}
                registerLabelRef={registerLabelRef}
              />
              {node.warnings.length > 0 ? (
                <div className="tree-warning-list" style={{ marginLeft: `${depth * 16 + 24}px` }}>
                  <WarningGroups compact locale={locale} warnings={node.warnings} />
                </div>
              ) : null}
            </li>
          );
        })}
        {virtualLayout.bottomSpacerHeight > 0 ? <li aria-hidden="true" className="tree-virtual-spacer" style={{ height: `${virtualLayout.bottomSpacerHeight}px` }} /> : null}
      </ul>
    </div>
  );
}
