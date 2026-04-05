import { chromium, expect } from "@playwright/test";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, "..");
const workspaceRoot = path.resolve(projectRoot, "..", "..");
const outputRoot = path.resolve(workspaceRoot, "output", "full-ui-selftest");
const runId = new Date().toISOString().replace(/[.:]/g, "-");
const runDir = path.join(outputRoot, runId);
const host = "127.0.0.1";
const headed = process.argv.includes("--headed");
const fixturesPath = path.resolve(projectRoot, "src", "test-support", "ui-fixtures.json");

async function loadFixtures() {
  return JSON.parse(await readFile(fixturesPath, "utf8"));
}

function slug(value) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "") || "step";
}

async function ensureDir(dirPath) {
  await mkdir(dirPath, { recursive: true });
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function reservePort() {
  return await new Promise((resolve, reject) => {
    const server = createServer();
    server.unref();
    server.on("error", reject);
    server.listen(0, host, () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        server.close();
        reject(new Error("Could not reserve a TCP port for the QA server."));
        return;
      }

      const { port } = address;
      server.close((error) => {
        if (error) {
          reject(error);
          return;
        }
        resolve(port);
      });
    });
  });
}

async function waitForServer(url, serverProcess, timeoutMs = 60000) {
  return await new Promise((resolve, reject) => {
    let settled = false;
    const deadline = Date.now() + timeoutMs;

    const cleanup = () => {
      serverProcess.off("exit", onExit);
      serverProcess.off("error", onError);
    };

    const onExit = (code, signal) => {
      if (settled) {
        return;
      }
      settled = true;
      cleanup();
      reject(new Error(`Vite exited before becoming ready (code=${code}, signal=${signal}).`));
    };

    const onError = (error) => {
      if (settled) {
        return;
      }
      settled = true;
      cleanup();
      reject(error);
    };

    const poll = async () => {
      while (!settled && Date.now() < deadline) {
        try {
          const response = await fetch(url);
          if (response.ok) {
            settled = true;
            cleanup();
            resolve();
            return;
          }
        } catch {
          // keep polling until the dev server comes up
        }
        await delay(250);
      }

      if (!settled) {
        settled = true;
        cleanup();
        reject(new Error(`Timed out waiting for dev server at ${url}`));
      }
    };

    serverProcess.once("exit", onExit);
    serverProcess.once("error", onError);
    void poll();
  });
}

async function writeText(filePath, content) {
  await ensureDir(path.dirname(filePath));
  await writeFile(filePath, content, "utf8");
}

async function copyLatestReports(summaryJson, summaryMd) {
  await writeText(path.join(outputRoot, "latest.json"), JSON.stringify(summaryJson, null, 2));
  await writeText(path.join(outputRoot, "latest.md"), summaryMd);
}

function buildReportMarkdown(summary) {
  const lines = [
    "# Full UI Self-Test",
    "",
    `- Run ID: \`${summary.runId}\``,
    `- Status: ${summary.failedSteps === 0 ? "PASS" : "FAIL"}`,
    `- Steps: ${summary.passedSteps}/${summary.totalSteps} passed`,
    `- Artifacts: \`${summary.artifactDir}\``,
    "",
    "## Step Results",
    "",
  ];

  for (const step of summary.steps) {
    lines.push(`### ${step.status === "passed" ? "PASS" : "FAIL"} - ${step.name}`);
    lines.push(`- Scenario: ${step.scenario}`);
    if (step.note) {
      lines.push(`- Note: ${step.note}`);
    }
    if (step.screenshot) {
      lines.push(`- Screenshot: \`${step.screenshot}\``);
    }
    if (step.error) {
      lines.push("- Error:");
      lines.push("```text");
      lines.push(step.error);
      lines.push("```");
    }
    lines.push("");
  }

  if (summary.consoleMessages.length > 0) {
    lines.push("## Browser Diagnostics", "");
    for (const message of summary.consoleMessages) {
      lines.push(`- [${message.type}] ${message.scenario}: ${message.text}`);
    }
    lines.push("");
  }

  return lines.join("\n");
}

const initMockScript = ({ fixtures: mockFixtures, scenario }) => {
  const callbacks = new Map();
  const listeners = new Map();
  const pending = new Map();
  const calls = [];
  let nextCallbackId = 1;
  let historyCallCount = 0;
  const adminCategoryIds = mockFixtures.categoryPayload.filter((category) => category.requiresAdmin).map((category) => category.id);

  const scenarioConfig = {
    quickScanLock: false,
    fullScanLock: false,
    authLock: false,
    ...scenario,
  };

  const clone = (value) => JSON.parse(JSON.stringify(value));

  const registerCallback = (callback, once = false) => {
    const id = nextCallbackId++;
    callbacks.set(id, (payload) => {
      if (once) {
        callbacks.delete(id);
      }
      return callback?.(payload);
    });
    return id;
  };

  const emit = (eventName, payload) => {
    for (const callbackId of listeners.get(eventName) ?? []) {
      callbacks.get(callbackId)?.({ event: eventName, payload });
    }
  };

  const deferredResponse = (command, payload) => {
    if (pending.has(command)) {
      return pending.get(command).promise;
    }

    let release;
    const promise = new Promise((resolve) => {
      release = () => {
        pending.delete(command);
        resolve(clone(payload));
      };
    });

    pending.set(command, { release, promise });
    return promise;
  };

  window.__QA_MOCKS__ = {
    resolve(command) {
      const entry = pending.get(command);
      if (!entry) {
        return false;
      }
      entry.release();
      return true;
    },
    emitFullScanProgress(payload) {
      emit("full-scan-progress", payload);
    },
    getCalls() {
      return clone(calls);
    },
  };

  window.__TAURI_INTERNALS__ = {
    transformCallback: registerCallback,
    unregisterCallback: (id) => callbacks.delete(id),
    runCallback: (id, payload) => callbacks.get(id)?.(payload),
    invoke: async (command, args) => {
      calls.push({ command, args });

      switch (command) {
        case "list_categories":
          return clone(mockFixtures.categoryPayload);
        case "get_history":
          historyCallCount += 1;
          if (historyCallCount <= 1) {
            return clone(mockFixtures.initialHistoryPayload);
          }
          if (historyCallCount === 2) {
            return clone(mockFixtures.postScanHistoryPayload);
          }
          return clone(mockFixtures.postCleanHistoryPayload);
        case "analyze_elevation": {
          const ids = args?.categoryIds ?? [];
          const requestedAdminCategoryIds = ids.filter((id) => adminCategoryIds.includes(id));
          return {
            isProcessElevated: false,
            requiresElevation: requestedAdminCategoryIds.length > 0,
            adminCategoryIds: requestedAdminCategoryIds,
          };
        }
        case "restart_as_administrator":
          if (scenarioConfig.authLock) {
            return deferredResponse(command, null);
          }
          return null;
        case "scan_safe_defaults":
          if (scenarioConfig.quickScanLock) {
            return deferredResponse(command, mockFixtures.scanPayload);
          }
          return clone(mockFixtures.scanPayload);
        case "scan_categories":
          return clone(mockFixtures.preparedScanPayload);
        case "scan_full_tree":
          if (scenarioConfig.fullScanLock) {
            return deferredResponse(command, mockFixtures.fullScanPayload);
          }
          return clone(mockFixtures.fullScanPayload);
        case "expand_full_scan_node":
          return clone(mockFixtures.expandedTempPayload);
        case "clean_safe_defaults":
          return clone(mockFixtures.cleanPayload);
        case "clean_categories":
          return clone(mockFixtures.preparedCleanPayload);
        case "preview_selected_paths":
        case "delete_selected_paths":
          return clone(mockFixtures.deleteSelectedPathsPayload);
        case "plugin:event|listen": {
          const eventName = args.event;
          const callbackId = args.handler;
          if (!listeners.has(eventName)) {
            listeners.set(eventName, []);
          }
          listeners.get(eventName).push(callbackId);
          return callbackId;
        }
        case "plugin:event|unlisten": {
          const callbackId = args.eventId;
          for (const callbackIds of listeners.values()) {
            const index = callbackIds.indexOf(callbackId);
            if (index >= 0) {
              callbackIds.splice(index, 1);
            }
          }
          callbacks.delete(callbackId);
          return null;
        }
        default:
          throw new Error(`Unexpected mocked command: ${command}`);
      }
    },
  };

  window.__TAURI_EVENT_PLUGIN_INTERNALS__ = {
    unregisterListener: (_eventName, callbackId) => callbacks.delete(callbackId),
  };
};

async function createScenarioContext(browser, summary, scenarioName, scenarioConfig, baseUrl, fixtures) {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1100 } });
  page.on("console", (message) => {
    if (message.type() === "error" || message.type() === "warning") {
      summary.consoleMessages.push({ scenario: scenarioName, type: message.type(), text: message.text() });
    }
  });
  page.on("pageerror", (error) => {
    summary.consoleMessages.push({ scenario: scenarioName, type: "pageerror", text: error.stack ?? error.message });
  });

  await page.addInitScript(initMockScript, { fixtures, scenario: scenarioConfig });
  await page.goto(baseUrl, { waitUntil: "networkidle" });

  return page;
}

async function captureScreenshot(page, scenarioName, label) {
  const filePath = path.join(runDir, `${slug(scenarioName)}-${slug(label)}.png`);
  await page.screenshot({ path: filePath, fullPage: true });
  return filePath;
}

async function runStep(page, summary, scenarioName, stepName, action) {
  const entry = {
    scenario: scenarioName,
    name: stepName,
    status: "passed",
    screenshot: null,
    note: null,
    error: null,
  };

  try {
    await action(entry);
  } catch (error) {
    entry.status = "failed";
    entry.error = error instanceof Error ? error.stack ?? error.message : String(error);
    entry.screenshot = await captureScreenshot(page, scenarioName, `${stepName}-failure`).catch(() => null);
  }

  summary.steps.push(entry);
}

async function runScenario(browser, summary, scenarioName, scenarioConfig, scenarioRunner, baseUrl, fixtures) {
  const page = await createScenarioContext(browser, summary, scenarioName, scenarioConfig, baseUrl, fixtures);
  try {
    await scenarioRunner(page);
  } finally {
    await page.close();
  }
}

async function startServer(port) {
  const stdoutPath = path.join(runDir, "vite.stdout.log");
  const stderrPath = path.join(runDir, "vite.stderr.log");
  const viteCliPath = path.resolve(projectRoot, "node_modules", "vite", "bin", "vite.js");
  const server = spawn(
    process.execPath,
    [viteCliPath, "--host", host, "--port", String(port), "--strictPort"],
    {
      cwd: projectRoot,
      shell: false,
      env: { ...process.env },
    },
  );

  const stdoutChunks = [];
  const stderrChunks = [];
  server.stdout.on("data", (chunk) => stdoutChunks.push(Buffer.from(chunk)));
  server.stderr.on("data", (chunk) => stderrChunks.push(Buffer.from(chunk)));

  return {
    process: server,
    async flushLogs() {
      await writeText(stdoutPath, Buffer.concat(stdoutChunks).toString("utf8"));
      await writeText(stderrPath, Buffer.concat(stderrChunks).toString("utf8"));
    },
    stdoutPath,
    stderrPath,
  };
}

async function stopServer(server) {
  if (server.process.exitCode !== null) {
    return;
  }

  server.process.kill();
  await Promise.race([
    once(server.process, "exit"),
    delay(5000),
  ]);

  if (server.process.exitCode === null && process.platform === "win32") {
    const killer = spawn("taskkill", ["/PID", String(server.process.pid), "/T", "/F"], { stdio: "ignore" });
    await once(killer, "exit").catch(() => undefined);
  }
}

async function main() {
  await rm(runDir, { recursive: true, force: true });
  await ensureDir(runDir);
  const fixtures = await loadFixtures();

  const summary = {
    runId,
    artifactDir: runDir,
    baseUrl: null,
    steps: [],
    consoleMessages: [],
    serverLogs: {},
  };

  const port = await reservePort();
  const baseUrl = `http://${host}:${port}`;
  let server;

  let browser;

  try {
    server = await startServer(port);
    summary.baseUrl = baseUrl;
    summary.serverLogs = {
      stdout: server.stdoutPath,
      stderr: server.stderrPath,
    };
    await waitForServer(baseUrl, server.process);
    browser = await chromium.launch({ headless: !headed });

    await runScenario(browser, summary, "quick-scan-lock", { quickScanLock: true }, async (page) => {
      await runStep(page, summary, "quick-scan-lock", "home actions lock while quick scan is running", async (entry) => {
        await page.getByRole("button", { name: "Quick Scan" }).click();
        await expect(page.getByRole("button", { name: "Scanning..." })).toBeDisabled();
        await expect(page.getByRole("button", { name: "Full Scan" })).toBeDisabled();
        await expect(page.getByRole("button", { name: "Authorization mode" })).toBeDisabled();
        await expect(page.getByRole("button", { name: "Results" })).toBeDisabled();
        const callCounts = await page.evaluate(() => ({
          fullScanCalls: window.__QA_MOCKS__.getCalls().filter((call) => call.command === "scan_full_tree").length,
          authCalls: window.__QA_MOCKS__.getCalls().filter((call) => call.command === "restart_as_administrator").length,
        }));
        await expect(callCounts.fullScanCalls).toBe(0);
        await expect(callCounts.authCalls).toBe(0);
        await page.evaluate(() => window.__QA_MOCKS__.resolve("scan_safe_defaults"));
        await page.getByText("250.00 KB reclaimable").waitFor();
        entry.screenshot = await captureScreenshot(page, "quick-scan-lock", "results-ready");
      });
    }, baseUrl, fixtures);

    await runScenario(browser, summary, "quick-scan-review", {}, async (page) => {
      await runStep(page, summary, "quick-scan-review", "quick scan review and clean flow", async (entry) => {
        await page.getByRole("button", { name: "Quick Scan" }).click();
        await page.getByText("250.00 KB reclaimable").waitFor();
        await page.getByRole("button", { name: /Shader Cache/ }).click();
        await page.getByText("Warning mix").waitFor();
        await page.getByRole("button", { name: "Review & Clean" }).click();
        await page.getByText("Confirm safe clean").waitFor();
        await page.getByRole("button", { name: "Confirm Clean" }).click();
        await page.getByText(/Freed 250.00 KB/).waitFor();
        entry.screenshot = await captureScreenshot(page, "quick-scan-review", "clean-summary");
      });
    }, baseUrl, fixtures);

    await runScenario(browser, summary, "full-scan-lock", { fullScanLock: true }, async (page) => {
      await runStep(page, summary, "full-scan-lock", "full scan locks navigation and result mode switching", async (entry) => {
        await page.getByRole("button", { name: "Full Scan" }).click();
        await page.evaluate((progressPayload) => {
          window.__QA_MOCKS__.emitFullScanProgress(progressPayload);
        }, fixtures.fullScanProgressPayload);
        await page.getByRole("heading", { level: 1, name: "Scanning full tree" }).waitFor();
        await expect(page.getByRole("button", { name: "Home" })).toBeDisabled();
        await expect(page.getByRole("button", { name: "Authorization mode" })).toBeDisabled();
        await expect(page.getByRole("tab", { name: "Quick results" })).toBeDisabled();
        const safeScanCalls = await page.evaluate(() => window.__QA_MOCKS__.getCalls().filter((call) => call.command === "scan_safe_defaults").length);
        await expect(safeScanCalls).toBe(0);
        await page.evaluate(() => window.__QA_MOCKS__.resolve("scan_full_tree"));
        await page.getByText("4.00 KB reclaimable").waitFor();
        entry.screenshot = await captureScreenshot(page, "full-scan-lock", "tree-ready");
      });
    }, baseUrl, fixtures);

    await runScenario(browser, summary, "full-tree-review", {}, async (page) => {
      await runStep(page, summary, "full-tree-review", "full tree expand select and delete preview flow", async (entry) => {
        await page.getByRole("button", { name: "Full Scan" }).click();
        await page.getByText("4.00 KB reclaimable").waitFor();
        await page.getByRole("button", { name: "Expand Temp" }).click();
        await page.getByRole("button", { name: "cache.bin", exact: true }).waitFor();
        await page.getByRole("button", { name: "cache.bin", exact: true }).click();
        await page.getByLabel("Select cache.bin for deletion").click();
        await page.getByRole("button", { name: "Review delete selection" }).click();
        await page.getByText(/You are about to delete 1 selected results/).waitFor();
        await page.getByRole("button", { name: "Delete selected" }).click();
        await page.getByText(/Latest targeted delete/).waitFor();
        entry.screenshot = await captureScreenshot(page, "full-tree-review", "delete-summary");
      });
    }, baseUrl, fixtures);

    await runScenario(browser, summary, "prepared-flow", {}, async (page) => {
      await runStep(page, summary, "prepared-flow", "prepared preset scan and clean flow", async (entry) => {
        await page.getByRole("button", { name: "Categories" }).click();
        await page.getByRole("button", { name: "Use safe defaults" }).click();
        await page.getByRole("button", { name: "Scan prepared set" }).click();
        await page.getByText("Latest prepared scan").waitFor();
        await page.getByRole("button", { name: "Review & Clean" }).click();
        await page.getByText("Confirm prepared clean").waitFor();
        await page.getByRole("button", { name: "Confirm Clean" }).click();
        await page.getByText(/Freed 191.41 KB/).waitFor();
        entry.screenshot = await captureScreenshot(page, "prepared-flow", "prepared-clean-summary");
      });
    }, baseUrl, fixtures);

    await runScenario(browser, summary, "prepared-admin-guard", {}, async (page) => {
      await runStep(page, summary, "prepared-admin-guard", "admin preset scan is blocked until authorization mode", async (entry) => {
        await page.getByRole("button", { name: "Categories" }).click();
        await page.getByRole("button", { name: "Review admin set" }).click();
        await page.getByRole("button", { name: "Scan prepared set" }).click();
        await page.getByText(/Restart in authorization mode/).waitFor();
        await expect(page.getByRole("button", { name: "Authorization mode" })).toBeVisible();
        entry.screenshot = await captureScreenshot(page, "prepared-admin-guard", "elevation-blocked");
      });
    }, baseUrl, fixtures);

    await runScenario(browser, summary, "authorization-lock", { authLock: true }, async (page) => {
      await runStep(page, summary, "authorization-lock", "authorization action self-locks and ignores repeated clicks", async (entry) => {
        await page.getByRole("button", { name: "Authorization mode" }).click();
        await expect(page.getByRole("button", { name: "Starting authorization mode..." })).toBeDisabled();
        const restartCalls = await page.evaluate(() => window.__QA_MOCKS__.getCalls().filter((call) => call.command === "restart_as_administrator").length);
        await expect(restartCalls).toBe(1);
        await page.evaluate(() => window.__QA_MOCKS__.resolve("restart_as_administrator"));
        entry.screenshot = await captureScreenshot(page, "authorization-lock", "authorization-lock");
      });
    }, baseUrl, fixtures);

    await runScenario(browser, summary, "locale-flow", {}, async (page) => {
      await runStep(page, summary, "locale-flow", "settings language switch affects result workspace", async (entry) => {
        await page.getByRole("button", { name: "Full Scan" }).click();
        await page.getByText("4.00 KB reclaimable").waitFor();
        await page.getByRole("button", { name: "Settings" }).click();
        await page.getByRole("button", { name: "中文" }).click();
        await page.getByRole("button", { name: "结果" }).click();
        await page.getByText("当前聚焦节点", { exact: true }).waitFor();
        await page.getByRole("button", { name: "展开 Temp" }).click();
        await page.getByRole("button", { name: "cache.bin", exact: true }).waitFor();
        await expect(page.getByLabel("选择 cache.bin 进行删除")).toBeVisible();
        entry.screenshot = await captureScreenshot(page, "locale-flow", "locale-zh");
      });
    }, baseUrl, fixtures);
  } finally {
    if (browser) {
      await browser.close();
    }
    if (server) {
      await stopServer(server);
      await server.flushLogs();
    }
  }

  if (summary.consoleMessages.length > 0) {
    summary.steps.push({
      scenario: "diagnostics",
      name: "browser diagnostics stay clean",
      status: "failed",
      screenshot: null,
      note: `${summary.consoleMessages.length} console/page diagnostics captured`,
      error: summary.consoleMessages.map((message) => `[${message.type}] ${message.scenario}: ${message.text}`).join("\n"),
    });
  }

  summary.totalSteps = summary.steps.length;
  summary.failedSteps = summary.steps.filter((step) => step.status === "failed").length;
  summary.passedSteps = summary.totalSteps - summary.failedSteps;

  const summaryJsonPath = path.join(runDir, "summary.json");
  const summaryMdPath = path.join(runDir, "summary.md");
  const summaryMd = buildReportMarkdown(summary);
  await writeText(summaryJsonPath, JSON.stringify(summary, null, 2));
  await writeText(summaryMdPath, summaryMd);
  await copyLatestReports(summary, summaryMd);

  console.log(`Full UI self-test completed: ${summary.failedSteps === 0 ? "PASS" : "FAIL"}`);
  console.log(`Artifacts: ${runDir}`);

  if (summary.failedSteps > 0) {
    process.exitCode = 1;
  }
}

main().catch(async (error) => {
  await ensureDir(runDir);
  const fallbackSummary = {
    runId,
    artifactDir: runDir,
    totalSteps: 0,
    passedSteps: 0,
    failedSteps: 1,
    steps: [
      {
        scenario: "bootstrap",
        name: "start self-test",
        status: "failed",
        screenshot: null,
        note: null,
        error: error instanceof Error ? error.stack ?? error.message : String(error),
      },
    ],
    consoleMessages: [],
    serverLogs: {},
  };
  const summaryMd = buildReportMarkdown(fallbackSummary);
  await writeText(path.join(runDir, "summary.json"), JSON.stringify(fallbackSummary, null, 2));
  await writeText(path.join(runDir, "summary.md"), summaryMd);
  await copyLatestReports(fallbackSummary, summaryMd);
  console.error(error);
  process.exitCode = 1;
});
