// @vitest-environment jsdom

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { FileTreeView } from "./FileTreeView";
import type { FullScanTreeNode } from "../lib/contracts";

import { cleanup } from "@testing-library/react";

afterEach(() => {
  cleanup();
});

function createTree(overrides?: Partial<FullScanTreeNode>): FullScanTreeNode {
  return {
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
    ],
    ...overrides,
  };
}

function createLargeTree(count: number): FullScanTreeNode {
  return createTree({
    children: Array.from({ length: count }, (_, index) => ({
      path: `C:\\item-${index.toString().padStart(2, "0")}`,
      name: `item-${index.toString().padStart(2, "0")}`,
      isDirectory: false,
      sizeBytes: 1024 + index,
      hasChildren: false,
      childrenLoaded: true,
      warnings: [],
      children: [],
    })),
  });
}

describe("FileTreeView", () => {
  it("prevents duplicate lazy expansion requests while a node is loading", async () => {
    const user = userEvent.setup();
    let resolveExpand: (() => void) | undefined;
    const onExpandNode = vi.fn(() => new Promise<void>((resolve) => {
      resolveExpand = resolve;
    }));

    render(
      <FileTreeView
        locale="en"
        root={createTree()}
        onExpandNode={onExpandNode}
        onSelectNode={vi.fn()}
        onToggleDeletePath={vi.fn()}
        selectedPath={null}
        selectedNodeChildrenLoaded={false}
        selectedDeletePathSet={new Set()}
        selectedTrailPathSet={new Set()}
        rootPath="C:\\"
      />,
    );

    const expandButton = screen.getByRole("button", { name: "Expand Temp" });
    await user.click(expandButton);
    await user.click(screen.getByRole("button", { name: "Expand Temp" }));

    expect(onExpandNode).toHaveBeenCalledTimes(1);
    await waitFor(() => expect((screen.getByRole("button", { name: "Expand Temp" }) as HTMLButtonElement).disabled).toBe(true));

    if (resolveExpand) {
      resolveExpand();
    }
    await waitFor(() => expect((screen.getByRole("button", { name: "Expand Temp" }) as HTMLButtonElement).disabled).toBe(false));
  });

  it("keeps a lazy folder collapsed when loading children fails", async () => {
    const user = userEvent.setup();
    const onExpandNode = vi.fn().mockRejectedValue(new Error("boom"));

    render(
      <FileTreeView
        locale="en"
        root={createTree()}
        onExpandNode={onExpandNode}
        onSelectNode={vi.fn()}
        onToggleDeletePath={vi.fn()}
        selectedPath={null}
        selectedNodeChildrenLoaded={false}
        selectedDeletePathSet={new Set()}
        selectedTrailPathSet={new Set()}
        rootPath="C:\\"
      />,
    );

    await user.click(screen.getByRole("button", { name: "Expand Temp" }));

    expect(onExpandNode).toHaveBeenCalledTimes(1);
    await waitFor(() => expect((screen.getByRole("button", { name: "Expand Temp" }) as HTMLButtonElement).disabled).toBe(false));
    expect(screen.queryByRole("button", { name: "Collapse Temp" })).toBeNull();
    expect(screen.queryByRole("button", { name: "cache.bin" })).toBeNull();
  });

  it("locks loaded nodes open while the filtered tree forces expansion", () => {
    render(
      <FileTreeView
        locale="en"
        root={createTree({
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
          ],
        })}
        forceExpandAll
        onExpandNode={vi.fn()}
        onSelectNode={vi.fn()}
        onToggleDeletePath={vi.fn()}
        selectedPath={null}
        selectedNodeChildrenLoaded={false}
        selectedDeletePathSet={new Set()}
        selectedTrailPathSet={new Set()}
        rootPath="C:\\"
      />,
    );

    expect((screen.getByRole("button", { name: "Temp is expanded while filtering" }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByRole("button", { name: "cache.bin" })).toBeTruthy();
  });

  it("localizes tree control labels in Chinese", () => {
    render(
      <FileTreeView
        locale="zh"
        root={createTree()}
        onExpandNode={vi.fn().mockResolvedValue(undefined)}
        onSelectNode={vi.fn()}
        onToggleDeletePath={vi.fn()}
        selectedPath={null}
        selectedNodeChildrenLoaded={false}
        selectedDeletePathSet={new Set()}
        selectedTrailPathSet={new Set()}
        rootPath="C:\\"
      />,
    );

    expect(screen.getByRole("button", { name: "展开 Temp" })).toBeTruthy();
    expect(screen.getByLabelText("选择 Temp 进行删除")).toBeTruthy();
  });

  it("auto-expands the selected trail so loaded descendants become visible", async () => {
    render(
      <FileTreeView
        locale="en"
        root={createTree({
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
          ],
        })}
        onExpandNode={vi.fn().mockResolvedValue(undefined)}
        onSelectNode={vi.fn()}
        onToggleDeletePath={vi.fn()}
        selectedPath="C:\\Temp"
        selectedNodeChildrenLoaded={true}
        selectedDeletePathSet={new Set()}
        selectedTrailPathSet={new Set(["C:\\", "C:\\Temp"])}
        rootPath="C:\\"
      />,
    );

    expect((await screen.findAllByRole("button", { name: "cache.bin" })).length).toBeGreaterThanOrEqual(1);
  });

  it("loads and expands a directory when clicking its label", async () => {
    const user = userEvent.setup();
    const onExpandNode = vi.fn().mockResolvedValue(undefined);
    const onSelectNode = vi.fn();

    render(
      <FileTreeView
        locale="en"
        root={createTree()}
        onExpandNode={onExpandNode}
        onSelectNode={onSelectNode}
        onToggleDeletePath={vi.fn()}
        selectedPath={null}
        selectedNodeChildrenLoaded={false}
        selectedDeletePathSet={new Set()}
        selectedTrailPathSet={new Set()}
        rootPath="C:\\"
      />,
    );

    await user.click(screen.getByRole("button", { name: "Temp/" }));

    expect(onSelectNode).toHaveBeenCalledWith("C:\\Temp");
    expect(onExpandNode).toHaveBeenCalledWith("C:\\Temp");
  });

  it("disables tree interactions when the parent workflow is busy", () => {
    render(
      <FileTreeView
        locale="en"
        root={createTree()}
        interactionDisabled
        onExpandNode={vi.fn().mockResolvedValue(undefined)}
        onSelectNode={vi.fn()}
        onToggleDeletePath={vi.fn()}
        selectedPath={null}
        selectedNodeChildrenLoaded={false}
        selectedDeletePathSet={new Set()}
        selectedTrailPathSet={new Set()}
        rootPath="C:\\"
      />,
    );

    expect((screen.getAllByRole("button", { name: "Expand Temp" }).slice(-1)[0] as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getAllByRole("button", { name: "Temp/" }).slice(-1)[0] as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getAllByLabelText("Select Temp for deletion").slice(-1)[0] as HTMLInputElement).disabled).toBe(true);
  });

  it("window-renders large visible trees and reveals later nodes on scroll", async () => {
    render(
      <FileTreeView
        locale="en"
        root={createLargeTree(240)}
        onExpandNode={vi.fn().mockResolvedValue(undefined)}
        onSelectNode={vi.fn()}
        onToggleDeletePath={vi.fn()}
        selectedPath={null}
        selectedNodeChildrenLoaded={false}
        selectedDeletePathSet={new Set()}
        selectedTrailPathSet={new Set()}
        rootPath="C:\"
        virtualizationViewportHeightPx={120}
      />,
    );

    expect(screen.getByRole("button", { name: "item-00" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "item-223" })).toBeNull();

    const scrollRegion = screen.getByTestId("tree-scroll-region");
    fireEvent.scroll(scrollRegion, { target: { scrollTop: 12000 } });

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "item-223" })).toBeTruthy();
    });
  });
});
