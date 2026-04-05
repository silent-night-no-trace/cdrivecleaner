import type { FullScanTreeNode } from "./contracts";

export interface FilteredTreeResult {
  tree: FullScanTreeNode | null;
  visibleNodeCount: number;
}

function resolveSearchText(node: FullScanTreeNode, searchTextByPath?: ReadonlyMap<string, string>): string {
  return searchTextByPath?.get(node.path) ?? `${node.name}\n${node.path}`.toLowerCase();
}

export function filterLoadedTreeWithCount(
  node: FullScanTreeNode,
  query: string,
  searchTextByPath?: ReadonlyMap<string, string>,
): FilteredTreeResult {
  const normalized = query.trim().toLowerCase();
  if (!normalized) {
    return {
      tree: node,
      visibleNodeCount: countVisibleNodes(node),
    };
  }

  const selfMatches = resolveSearchText(node, searchTextByPath).includes(normalized);
  const filteredChildren: FullScanTreeNode[] = [];
  let visibleNodeCount = 0;

  for (const child of node.children) {
    const filteredChild = filterLoadedTreeWithCount(child, normalized, searchTextByPath);
    if (filteredChild.tree) {
      filteredChildren.push(filteredChild.tree);
      visibleNodeCount += filteredChild.visibleNodeCount;
    }
  }

  if (selfMatches || filteredChildren.length > 0) {
    return {
      tree: {
        ...node,
        children: filteredChildren,
      },
      visibleNodeCount: visibleNodeCount + 1,
    };
  }

  return {
    tree: null,
    visibleNodeCount: 0,
  };
}

export function filterLoadedTree(node: FullScanTreeNode, query: string): FullScanTreeNode | null {
  return filterLoadedTreeWithCount(node, query).tree;
}

export function countVisibleNodes(node: FullScanTreeNode): number {
  return 1 + node.children.map(countVisibleNodes).reduce((sum, value) => sum + value, 0);
}
