import { describe, expect, it } from "vitest";
import type { FullScanTreeNode } from "./contracts";
import { countVisibleNodes, filterLoadedTree, filterLoadedTreeWithCount } from "./filterTree";
import { buildFullScanTreeIndex } from "./fullScanTree";

function sampleTree(): FullScanTreeNode {
  return {
    path: "C:/",
    name: "C:/",
    isDirectory: true,
    sizeBytes: 4096,
    hasChildren: true,
    childrenLoaded: true,
    warnings: [],
    children: [
      {
        path: "C:/Temp",
        name: "Temp",
        isDirectory: true,
        sizeBytes: 3072,
        hasChildren: true,
        childrenLoaded: true,
        warnings: [],
        children: [
          {
            path: "C:/Temp/cache.bin",
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
        path: "C:/notes.txt",
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

describe("filterLoadedTree", () => {
  it("returns the original tree when query is empty", () => {
    const tree = sampleTree();
    expect(filterLoadedTree(tree, "")).toEqual(tree);
  });

  it("keeps matching ancestors and prunes non-matching loaded branches", () => {
    const filtered = filterLoadedTree(sampleTree(), "cache");
    expect(filtered).not.toBeNull();
    expect(filtered?.children).toHaveLength(1);
    expect(filtered?.children[0]?.name).toBe("Temp");
    expect(filtered?.children[0]?.children[0]?.name).toBe("cache.bin");
  });

  it("counts visible nodes in the filtered tree", () => {
    const filtered = filterLoadedTree(sampleTree(), "notes")!;
    expect(countVisibleNodes(filtered)).toBe(2);
  });

  it("returns filtered tree and visible count in one traversal", () => {
    const filtered = filterLoadedTreeWithCount(sampleTree(), "notes");

    expect(filtered.visibleNodeCount).toBe(2);
    expect(filtered.tree?.children).toHaveLength(1);
    expect(filtered.tree?.children[0]?.path).toBe("C:/notes.txt");
  });

  it("reuses precomputed search text when available", () => {
    const tree = sampleTree();
    const index = buildFullScanTreeIndex(tree);
    const filtered = filterLoadedTreeWithCount(tree, "cache", index.searchTextByPath);

    expect(filtered.visibleNodeCount).toBe(3);
    expect(filtered.tree?.children[0]?.children[0]?.name).toBe("cache.bin");
  });
});
