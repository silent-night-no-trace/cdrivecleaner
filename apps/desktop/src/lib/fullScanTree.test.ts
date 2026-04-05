import { describe, expect, it } from "vitest";

import type { FullScanTreeNode } from "./contracts";
import { buildFullScanTreeIndex, buildNodeTrail, estimateDeleteSelection, getLoadedTreePreview, getTreemapBlocks, mergeExpandedFullScanNode, updateFullScanTreeIndex } from "./fullScanTree";

function createTree(): FullScanTreeNode {
  return {
    path: "C:\\",
    name: "C:\\",
    isDirectory: true,
    sizeBytes: 4096,
    hasChildren: true,
    childrenLoaded: true,
    warnings: [{ code: "FileInfoAccessDenied", severity: "Info", message: "root warning" }],
    children: [
      {
        path: "C:\\Temp",
        name: "Temp",
        isDirectory: true,
        sizeBytes: 3072,
        hasChildren: true,
        childrenLoaded: true,
        warnings: [],
        children: [
          {
            path: "C:\\Temp\\cache.bin",
            name: "cache.bin",
            isDirectory: false,
            sizeBytes: 3072,
            hasChildren: false,
            childrenLoaded: true,
            warnings: [],
            children: [],
          },
        ],
      },
      {
        path: "C:\\notes.txt",
        name: "notes.txt",
        isDirectory: false,
        sizeBytes: 1024,
        hasChildren: false,
        childrenLoaded: true,
        warnings: [],
        children: [],
      },
    ],
  };
}

describe("fullScanTree", () => {
  it("builds reusable summary and lookup indexes in one pass", () => {
    const tree = createTree();
    const index = buildFullScanTreeIndex(tree);

    expect(index.totalNodeCount).toBe(4);
    expect(index.allWarnings).toHaveLength(1);
    expect(index.nodeByPath.get("C:\\Temp\\cache.bin")?.name).toBe("cache.bin");
    expect(index.summaryByPath.get("C:\\")?.loadedDescendants).toBe(3);
    expect(index.summaryByPath.get("C:\\")?.loadedFiles).toBe(2);
    expect(index.summaryByPath.get("C:\\Temp")?.loadedFiles).toBe(1);
  });

  it("reconstructs a selected node trail without scanning the whole tree again", () => {
    const index = buildFullScanTreeIndex(createTree());
    const trail = buildNodeTrail(index, "C:\\Temp\\cache.bin");

    expect(trail.map((node) => node.path)).toEqual(["C:\\", "C:\\Temp", "C:\\Temp\\cache.bin"]);
  });

  it("estimates delete selection using cached subtree summaries", () => {
    const tree = createTree();
    const index = buildFullScanTreeIndex(tree);

    expect(estimateDeleteSelection(tree, new Set(["C:\\Temp"]), index.summaryByPath)).toEqual({ bytes: 3072, files: 1 });
    expect(estimateDeleteSelection(tree, new Set(["C:\\Temp", "C:\\Temp\\cache.bin"]), index.summaryByPath)).toEqual({ bytes: 3072, files: 1 });
  });

  it("builds top-file and top-path previews from the loaded subtree only", () => {
    const preview = getLoadedTreePreview(createTree());

    expect(preview.topFiles.map((node) => node.path)).toEqual(["C:\\Temp\\cache.bin", "C:\\notes.txt"]);
    expect(preview.topPaths.map((node) => node.path)).toEqual(["C:\\Temp"]);
  });

  it("excludes lazy descendants until they are loaded into the tree", () => {
    const preview = getLoadedTreePreview({
      path: "C:\\",
      name: "C:\\",
      isDirectory: true,
      sizeBytes: 4096,
      hasChildren: true,
      childrenLoaded: true,
      warnings: [],
      children: [
        {
          path: "C:\\Temp",
          name: "Temp",
          isDirectory: true,
          sizeBytes: 3072,
          hasChildren: true,
          childrenLoaded: false,
          warnings: [],
          children: [],
        },
        {
          path: "C:\\notes.txt",
          name: "notes.txt",
          isDirectory: false,
          sizeBytes: 1024,
          hasChildren: false,
          childrenLoaded: true,
          warnings: [],
          children: [],
        },
      ],
    });

    expect(preview.topFiles.map((node) => node.path)).toEqual(["C:\\notes.txt"]);
    expect(preview.topPaths.map((node) => node.path)).toEqual(["C:\\Temp"]);
  });

  it("builds treemap blocks from the current node children ranked by size", () => {
    const blocks = getTreemapBlocks(createTree());

    expect(blocks.map((block) => block.path)).toEqual(["C:\\Temp", "C:\\notes.txt"]);
    expect(blocks[0]).toMatchObject({
      label: "Temp/",
      isDirectory: true,
      isLazy: false,
      warningCount: 0,
      loadedDescendants: 1,
      lazyDescendantCount: 0,
    });
    expect(blocks[0]?.columnSpan).toBeGreaterThan(blocks[1]?.columnSpan ?? 0);
  });

  it("tracks warning severity breakdown and lazy descendants in treemap blocks", () => {
    const blocks = getTreemapBlocks({
      path: "C:\\",
      name: "C:\\",
      isDirectory: true,
      sizeBytes: 8192,
      hasChildren: true,
      childrenLoaded: true,
      warnings: [],
      children: [
        {
          path: "C:\\Logs",
          name: "Logs",
          isDirectory: true,
          sizeBytes: 6144,
          hasChildren: true,
          childrenLoaded: true,
          warnings: [{ code: "PathScanFailed", severity: "Critical", message: "Critical failure" }],
          children: [
            {
              path: "C:\\Logs\\lazy",
              name: "lazy",
              isDirectory: true,
              sizeBytes: 2048,
              hasChildren: true,
              childrenLoaded: false,
              warnings: [{ code: "FileInfoAccessDenied", severity: "Attention", message: "Attention issue" }],
              children: [],
            },
          ],
        },
      ],
    });

    expect(blocks[0]).toMatchObject({
      warningCount: 2,
      loadedDescendants: 1,
      lazyDescendantCount: 1,
      warningBreakdown: {
        Critical: 1,
        Attention: 1,
        Info: 0,
      },
    });
  });

  it("only rewrites the updated branch when merging an expanded node", () => {
    const tree = {
      path: "C:\\",
      name: "C:\\",
      isDirectory: true,
      sizeBytes: 8192,
      hasChildren: true,
      childrenLoaded: true,
      warnings: [],
      children: [
        {
          path: "C:\\Temp",
          name: "Temp",
          isDirectory: true,
          sizeBytes: 4096,
          hasChildren: true,
          childrenLoaded: false,
          warnings: [],
          children: [],
        },
        {
          path: "C:\\Windows",
          name: "Windows",
          isDirectory: true,
          sizeBytes: 4096,
          hasChildren: true,
          childrenLoaded: false,
          warnings: [],
          children: [],
        },
      ],
    } satisfies FullScanTreeNode;

    const untouchedBranch = tree.children[1];
    const expandedTemp = {
      path: "C:\\Temp",
      name: "Temp",
      isDirectory: true,
      sizeBytes: 4096,
      hasChildren: true,
      childrenLoaded: true,
      warnings: [],
      children: [
        {
          path: "C:\\Temp\\cache.bin",
          name: "cache.bin",
          isDirectory: false,
          sizeBytes: 1024,
          hasChildren: false,
          childrenLoaded: true,
          warnings: [],
          children: [],
        },
      ],
    } satisfies FullScanTreeNode;

    const merged = mergeExpandedFullScanNode(tree, expandedTemp);

    expect(merged).not.toBe(tree);
    expect(merged.children[0]).toBe(expandedTemp);
    expect(merged.children[1]).toBe(untouchedBranch);
  });

  it("only rewrites ancestors of a deep expanded node", () => {
    const tree = createTree();
    const untouchedFile = tree.children[1];
    const expandedChild = {
      path: "C:\\Temp\\cache.bin",
      name: "cache.bin",
      isDirectory: false,
      sizeBytes: 3072,
      hasChildren: false,
      childrenLoaded: true,
      warnings: [],
      children: [],
    } satisfies FullScanTreeNode;

    const merged = mergeExpandedFullScanNode(tree, expandedChild);

    expect(merged.children[1]).toBe(untouchedFile);
    expect(merged.children[0]).not.toBe(tree.children[0]);
  });

  it("updates a full-scan index incrementally after expanding a subtree", () => {
    const tree = createTree();
    const initialIndex = buildFullScanTreeIndex(tree);
    const expandedTemp = {
      path: "C:\\Temp",
      name: "Temp",
      isDirectory: true,
      sizeBytes: 4096,
      hasChildren: true,
      childrenLoaded: true,
      warnings: [{ code: "PathScanFailed", severity: "Attention", message: "partial read" }],
      children: [
        {
          path: "C:\\Temp\\cache.bin",
          name: "cache.bin",
          isDirectory: false,
          sizeBytes: 3072,
          hasChildren: false,
          childrenLoaded: true,
          warnings: [],
          children: [],
        },
        {
          path: "C:\\Temp\\nested",
          name: "nested",
          isDirectory: true,
          sizeBytes: 1024,
          hasChildren: true,
          childrenLoaded: false,
          warnings: [],
          children: [],
        },
      ],
    } satisfies FullScanTreeNode;
    const mergedTree = mergeExpandedFullScanNode(tree, expandedTemp);

    const incrementalIndex = updateFullScanTreeIndex(initialIndex, mergedTree, expandedTemp);
    const rebuiltIndex = buildFullScanTreeIndex(mergedTree);

    expect(incrementalIndex.totalNodeCount).toBe(rebuiltIndex.totalNodeCount);
    expect(incrementalIndex.nodeByPath.get("C:\\Temp\\nested")?.name).toBe("nested");
    expect(incrementalIndex.summaryByPath.get("C:\\Temp")).toEqual(rebuiltIndex.summaryByPath.get("C:\\Temp"));
    expect(incrementalIndex.summaryByPath.get("C:\\")).toEqual(rebuiltIndex.summaryByPath.get("C:\\"));
    expect(incrementalIndex.allWarnings).toEqual(rebuiltIndex.allWarnings);
  });
});
