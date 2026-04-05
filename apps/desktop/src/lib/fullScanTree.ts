import type { CleanupWarning, FullScanTreeNode, WarningSeverity } from "./contracts";

export interface TreeSummary {
  loadedDescendants: number;
  loadedFiles: number;
  loadedDirectories: number;
  loadedWarnings: number;
  largestChildren: FullScanTreeNode[];
  totalNodes: number;
}

export interface FullScanTreeIndex {
  allWarnings: CleanupWarning[];
  nodeByPath: Map<string, FullScanTreeNode>;
  parentPathByPath: Map<string, string | null>;
  searchTextByPath: Map<string, string>;
  summaryByPath: Map<string, TreeSummary>;
  totalNodeCount: number;
}

export interface LoadedTreePreview {
  topFiles: FullScanTreeNode[];
  topPaths: FullScanTreeNode[];
}

export interface TreemapBlock {
  path: string;
  label: string;
  sizeBytes: number;
  share: number;
  columnSpan: number;
  isDirectory: boolean;
  warningCount: number;
  warningBreakdown: Record<WarningSeverity, number>;
  loadedDescendants: number;
  lazyDescendantCount: number;
  isLazy: boolean;
}

interface TreemapSubtreeStats {
  loadedDescendants: number;
  lazyDescendantCount: number;
  warningCount: number;
  warningBreakdown: Record<WarningSeverity, number>;
}

function normalizeTreePath(path: string): string {
  const normalized = path.replace(/\\/g, "/");
  if (/^[A-Za-z]:\/?$/.test(normalized)) {
    return normalized.replace(/\/$/, "");
  }
  return normalized.replace(/\/+$/, "");
}

function isSameOrDescendantPath(ancestorPath: string, candidatePath: string): boolean {
  const normalizedAncestor = normalizeTreePath(ancestorPath);
  const normalizedCandidate = normalizeTreePath(candidatePath);
  return normalizedCandidate === normalizedAncestor || normalizedCandidate.startsWith(`${normalizedAncestor}/`);
}

function emptyWarningBreakdown(): Record<WarningSeverity, number> {
  return {
    Critical: 0,
    Attention: 0,
    Info: 0,
  };
}

function buildSearchText(node: FullScanTreeNode): string {
  return `${node.name}\n${node.path}`.toLowerCase();
}

function summarizeIndexedNode(node: FullScanTreeNode, summaryByPath: ReadonlyMap<string, TreeSummary>): TreeSummary {
  const childSummaries = node.children.map((child) => summaryByPath.get(child.path) ?? EMPTY_SUMMARY);
  const loadedDescendants = node.children.length + childSummaries.reduce((sum, summary) => sum + summary.loadedDescendants, 0);
  const loadedFiles = node.children.filter((child) => !child.isDirectory).length + childSummaries.reduce((sum, summary) => sum + summary.loadedFiles, 0);
  const loadedDirectories = node.children.filter((child) => child.isDirectory).length + childSummaries.reduce((sum, summary) => sum + summary.loadedDirectories, 0);
  const loadedWarnings = node.warnings.length + childSummaries.reduce((sum, summary) => sum + summary.loadedWarnings, 0);
  const largestChildren = [...node.children].sort((left, right) => right.sizeBytes - left.sizeBytes).slice(0, 3);

  return {
    loadedDescendants,
    loadedFiles,
    loadedDirectories,
    loadedWarnings,
    largestChildren,
    totalNodes: loadedDescendants + 1,
  };
}

function collectSubtreeWarningSet(node: FullScanTreeNode, target: Set<CleanupWarning>): void {
  for (const warning of node.warnings) {
    target.add(warning);
  }
  for (const child of node.children) {
    collectSubtreeWarningSet(child, target);
  }
}

function collectSubtreePaths(node: FullScanTreeNode, target: string[]): void {
  target.push(node.path);
  for (const child of node.children) {
    collectSubtreePaths(child, target);
  }
}

function buildNodeTrailFromTree(root: FullScanTreeNode, targetPath: string): FullScanTreeNode[] | null {
  if (root.path === targetPath) {
    return [root];
  }

  if (!isSameOrDescendantPath(root.path, targetPath)) {
    return null;
  }

  for (const child of root.children) {
    if (!isSameOrDescendantPath(child.path, targetPath)) {
      continue;
    }
    const childTrail = buildNodeTrailFromTree(child, targetPath);
    if (childTrail) {
      return [root, ...childTrail];
    }
  }

  return null;
}

const EMPTY_SUMMARY: TreeSummary = {
  loadedDescendants: 0,
  loadedFiles: 0,
  loadedDirectories: 0,
  loadedWarnings: 0,
  largestChildren: [],
  totalNodes: 1,
};

export function buildFullScanTreeIndex(root: FullScanTreeNode): FullScanTreeIndex {
  const nodeByPath = new Map<string, FullScanTreeNode>();
  const parentPathByPath = new Map<string, string | null>();
  const searchTextByPath = new Map<string, string>();
  const summaryByPath = new Map<string, TreeSummary>();
  const allWarnings: CleanupWarning[] = [];

  const visit = (node: FullScanTreeNode, parentPath: string | null): TreeSummary => {
    nodeByPath.set(node.path, node);
    parentPathByPath.set(node.path, parentPath);
    searchTextByPath.set(node.path, buildSearchText(node));
    allWarnings.push(...node.warnings);

    const childSummaries = node.children.map((child) => visit(child, node.path));
    const loadedDescendants = node.children.length + childSummaries.reduce((sum, summary) => sum + summary.loadedDescendants, 0);
    const loadedFiles = node.children.filter((child) => !child.isDirectory).length + childSummaries.reduce((sum, summary) => sum + summary.loadedFiles, 0);
    const loadedDirectories = node.children.filter((child) => child.isDirectory).length + childSummaries.reduce((sum, summary) => sum + summary.loadedDirectories, 0);
    const loadedWarnings = node.warnings.length + childSummaries.reduce((sum, summary) => sum + summary.loadedWarnings, 0);
    const largestChildren = [...node.children].sort((left, right) => right.sizeBytes - left.sizeBytes).slice(0, 3);
    const summary: TreeSummary = {
      loadedDescendants,
      loadedFiles,
      loadedDirectories,
      loadedWarnings,
      largestChildren,
      totalNodes: loadedDescendants + 1,
    };

    summaryByPath.set(node.path, summary);
    return summary;
  };

  const rootSummary = visit(root, null);
  return {
    allWarnings,
    nodeByPath,
    parentPathByPath,
    searchTextByPath,
    summaryByPath,
    totalNodeCount: rootSummary.totalNodes,
  };
}

export function updateFullScanTreeIndex(index: FullScanTreeIndex, root: FullScanTreeNode, updatedNode: FullScanTreeNode): FullScanTreeIndex {
  const previousNode = index.nodeByPath.get(updatedNode.path);
  if (!previousNode) {
    return buildFullScanTreeIndex(root);
  }

  const nodeByPath = new Map(index.nodeByPath);
  const parentPathByPath = new Map(index.parentPathByPath);
  const searchTextByPath = new Map(index.searchTextByPath);
  const summaryByPath = new Map(index.summaryByPath);
  const previousPaths: string[] = [];
  collectSubtreePaths(previousNode, previousPaths);
  for (const path of previousPaths) {
    nodeByPath.delete(path);
    parentPathByPath.delete(path);
    searchTextByPath.delete(path);
    summaryByPath.delete(path);
  }

  const nextWarnings: CleanupWarning[] = [];
  const indexSubtree = (node: FullScanTreeNode, parentPath: string | null): TreeSummary => {
    nodeByPath.set(node.path, node);
    parentPathByPath.set(node.path, parentPath);
    searchTextByPath.set(node.path, buildSearchText(node));
    nextWarnings.push(...node.warnings);

    for (const child of node.children) {
      indexSubtree(child, node.path);
    }

    const summary = summarizeIndexedNode(node, summaryByPath);
    summaryByPath.set(node.path, summary);
    return summary;
  };

  indexSubtree(updatedNode, index.parentPathByPath.get(updatedNode.path) ?? null);

  const trail = buildNodeTrailFromTree(root, updatedNode.path);
  if (!trail) {
    return buildFullScanTreeIndex(root);
  }

  for (let indexInTrail = trail.length - 2; indexInTrail >= 0; indexInTrail -= 1) {
    const node = trail[indexInTrail]!;
    const parentPath = indexInTrail > 0 ? trail[indexInTrail - 1]!.path : null;
    nodeByPath.set(node.path, node);
    parentPathByPath.set(node.path, parentPath);
    summaryByPath.set(node.path, summarizeIndexedNode(node, summaryByPath));
  }

  const previousWarnings = new Set<CleanupWarning>();
  collectSubtreeWarningSet(previousNode, previousWarnings);
  const allWarnings = index.allWarnings.filter((warning) => !previousWarnings.has(warning)).concat(nextWarnings);

  return {
    allWarnings,
    nodeByPath,
    parentPathByPath,
    searchTextByPath,
    summaryByPath,
    totalNodeCount: summaryByPath.get(root.path)?.totalNodes ?? 0,
  };
}

export function buildNodeTrail(index: FullScanTreeIndex, selectedPath: string | null): FullScanTreeNode[] {
  if (!selectedPath) {
    const root = index.nodeByPath.values().next().value;
    return root ? [root] : [];
  }

  const trail: FullScanTreeNode[] = [];
  let currentPath: string | null = selectedPath;

  while (currentPath) {
    const node = index.nodeByPath.get(currentPath);
    if (!node) {
      break;
    }
    trail.push(node);
    currentPath = index.parentPathByPath.get(currentPath) ?? null;
  }

  return trail.reverse();
}

export function mergeExpandedFullScanNode(tree: FullScanTreeNode, updatedNode: FullScanTreeNode): FullScanTreeNode {
  if (tree.path === updatedNode.path) {
    return updatedNode;
  }

  if (!isSameOrDescendantPath(tree.path, updatedNode.path)) {
    return tree;
  }

  let changed = false;
  const children = tree.children.map((child) => {
    const nextChild = mergeExpandedFullScanNode(child, updatedNode);
    if (nextChild !== child) {
      changed = true;
    }
    return nextChild;
  });

  if (!changed) {
    return tree;
  }

  return {
    ...tree,
    children,
  };
}

export function getTreeSummary(index: FullScanTreeIndex, path: string): TreeSummary {
  return index.summaryByPath.get(path) ?? EMPTY_SUMMARY;
}

export function getLoadedTreePreview(root: FullScanTreeNode, limit = 3): LoadedTreePreview {
  const topFiles: FullScanTreeNode[] = [];
  const topPaths: FullScanTreeNode[] = [];

  const visit = (node: FullScanTreeNode): void => {
    for (const child of node.children) {
      if (child.isDirectory) {
        topPaths.push(child);
        visit(child);
      } else {
        topFiles.push(child);
      }
    }
  };

  visit(root);

  const sortBySize = (left: FullScanTreeNode, right: FullScanTreeNode) => right.sizeBytes - left.sizeBytes || left.path.localeCompare(right.path, "en");

  return {
    topFiles: topFiles.sort(sortBySize).slice(0, limit),
    topPaths: topPaths.sort(sortBySize).slice(0, limit),
  };
}

export function getTreemapBlocks(root: FullScanTreeNode, limit = 12): TreemapBlock[] {
  const sortedChildren = [...root.children].sort((left, right) => right.sizeBytes - left.sizeBytes || left.path.localeCompare(right.path, "en"));
  const children = sortedChildren.slice(0, limit);
  const total = sortedChildren.reduce((sum, child) => sum + child.sizeBytes, 0);

  const collectSubtreeStats = (node: FullScanTreeNode): TreemapSubtreeStats => {
    const warningBreakdown = emptyWarningBreakdown();
    for (const warning of node.warnings) {
      warningBreakdown[warning.severity] += 1;
    }

    return node.children.reduce<TreemapSubtreeStats>((accumulator, child) => {
      const childStats = collectSubtreeStats(child);
      accumulator.loadedDescendants += childStats.loadedDescendants + 1;
      accumulator.lazyDescendantCount += childStats.lazyDescendantCount;
      accumulator.warningCount += childStats.warningCount;
      accumulator.warningBreakdown.Critical += childStats.warningBreakdown.Critical;
      accumulator.warningBreakdown.Attention += childStats.warningBreakdown.Attention;
      accumulator.warningBreakdown.Info += childStats.warningBreakdown.Info;
      return accumulator;
    }, {
      loadedDescendants: 0,
      lazyDescendantCount: node.isDirectory && node.hasChildren && !node.childrenLoaded ? 1 : 0,
      warningCount: node.warnings.length,
      warningBreakdown,
    });
  };

  return children.map((child) => {
    const stats = collectSubtreeStats(child);
    const share = total === 0 ? 0 : child.sizeBytes / total;
    return {
      path: child.path,
      label: child.isDirectory ? `${child.name}/` : child.name,
      sizeBytes: child.sizeBytes,
      share,
      columnSpan: Math.min(12, Math.max(3, Math.round(share * 12) || 3)),
      isDirectory: child.isDirectory,
      warningCount: stats.warningCount,
      warningBreakdown: stats.warningBreakdown,
      loadedDescendants: stats.loadedDescendants,
      lazyDescendantCount: stats.lazyDescendantCount,
      isLazy: child.isDirectory && child.hasChildren && !child.childrenLoaded,
    };
  });
}

export function estimateDeleteSelection(root: FullScanTreeNode, selectedPaths: ReadonlySet<string>, summaryByPath: ReadonlyMap<string, TreeSummary>): { bytes: number; files: number } {
  const visit = (node: FullScanTreeNode): { bytes: number; files: number } => {
    if (selectedPaths.has(node.path)) {
      return {
        bytes: node.sizeBytes,
        files: node.isDirectory ? (summaryByPath.get(node.path)?.loadedFiles ?? 0) : 1,
      };
    }

    return node.children.reduce(
      (accumulator, child) => {
        const childResult = visit(child);
        return {
          bytes: accumulator.bytes + childResult.bytes,
          files: accumulator.files + childResult.files,
        };
      },
      { bytes: 0, files: 0 },
    );
  };

  return visit(root);
}
