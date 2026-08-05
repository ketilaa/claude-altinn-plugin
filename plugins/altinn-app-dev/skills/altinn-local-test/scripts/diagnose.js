#!/usr/bin/env node
/**
 * Drives an Altinn app running against app-localtest through every configured layout page and
 * reports whatever Altinn app-frontend's own built-in developer-tools panel logs — data model
 * binding mismatches, missing page titles, unsupported languages, and similar issues that only
 * surface once the frontend actually renders the app. Neither `dotnet build` nor JSON-schema
 * validation catch these; they're semantic checks the React app performs at load time.
 *
 * Requires: `npm install playwright` (or run once via `npx playwright install chromium`).
 *
 * Usage:
 *   node diagnose.js --app-repo /path/to/app-repo --party-id 500000 [options]
 *
 * Options:
 *   --app-repo <path>       Path to the app repo root (containing App/). Required.
 *   --party-id <id>         Test party ID to instantiate as. Required.
 *   --user-id <id>          Test user ID (default: 1337)
 *   --auth-level <n>        Authentication level for the minted token (default: 2)
 *   --localtest-url <url>   Direct LocalTest API URL (default: http://localhost:5101)
 *   --gateway-url <url>     Browser-facing gateway URL (default: http://local.altinn.cloud)
 *   --headed                Show the browser window instead of running headless
 */

const fs = require("fs");
const path = require("path");
const { chromium } = require("playwright");

function parseArgs(argv) {
  const args = { userId: "1337", authLevel: "2", localtestUrl: "http://localhost:5101", gatewayUrl: "http://local.altinn.cloud", headed: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--app-repo") args.appRepo = argv[++i];
    else if (a === "--party-id") args.partyId = argv[++i];
    else if (a === "--user-id") args.userId = argv[++i];
    else if (a === "--auth-level") args.authLevel = argv[++i];
    else if (a === "--localtest-url") args.localtestUrl = argv[++i];
    else if (a === "--gateway-url") args.gatewayUrl = argv[++i];
    else if (a === "--headed") args.headed = true;
  }
  if (!args.appRepo || !args.partyId) {
    console.error("Usage: node diagnose.js --app-repo <path> --party-id <id> [--user-id 1337] [--auth-level 2] [--headed]");
    process.exit(2);
  }
  return args;
}

function readAppConfig(appRepo) {
  const metaPath = path.join(appRepo, "App", "config", "applicationmetadata.json");
  const settingsPath = path.join(appRepo, "App", "ui", "form", "Settings.json");
  const meta = JSON.parse(fs.readFileSync(metaPath, "utf8"));
  const settings = JSON.parse(fs.readFileSync(settingsPath, "utf8"));
  const [org, app] = meta.id.split("/");
  const pages = settings.pages.order;
  return { org, app, pages };
}

async function mintToken(localtestUrl, userId, partyId, authLevel) {
  const url = `${localtestUrl}/Home/auth/user?userId=${userId}&partyId=${partyId}&authenticationLevel=${authLevel}`;
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Failed to mint token (${res.status}): ${await res.text()}`);
  }
  return (await res.text()).trim();
}

async function instantiate(gatewayUrl, org, app, partyId, token) {
  const url = `${gatewayUrl}/${org}/${app}/instances?instanceOwnerPartyId=${partyId}`;
  const res = await fetch(url, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
  });
  if (!res.ok) {
    throw new Error(`Failed to instantiate (${res.status}): ${await res.text()}`);
  }
  const instance = await res.json();
  const [instanceOwnerPartyId, instanceGuid] = instance.id.split("/");
  const currentTask = instance.process?.currentTask?.elementId ?? "Task_1";
  return { instanceOwnerPartyId, instanceGuid, currentTask };
}

async function collectDevToolsLog(page) {
  // Open the panel if it's not already open, then switch to its "Logger" tab.
  const toggle = page.getByRole("button", { name: /utviklerverk/i });
  if (await toggle.isVisible().catch(() => false)) {
    const alreadyOpen = await page.getByRole("tab", { name: /logger/i }).isVisible().catch(() => false);
    if (!alreadyOpen) {
      await toggle.click();
    }
  }
  const loggerTab = page.getByRole("tab", { name: /logger/i });
  if (!(await loggerTab.isVisible().catch(() => false))) {
    // Panel toggle wasn't found at all - nothing to collect (older/newer frontend version?).
    return [];
  }
  await loggerTab.click();
  await page.waitForTimeout(300);

  // Log entries render as a numbered list; grab every non-empty line of visible text in the
  // logger tabpanel. All tab panels stay mounted in the DOM at once (only the active one is
  // exposed via the accessibility tree), so query by role rather than a raw [id^=tabpanel-]
  // selector - the latter matched whichever panel happened to be last in DOM order, not the
  // active one.
  const panelText = await page
    .getByRole("tabpanel")
    .innerText()
    .catch(() => "");

  return panelText
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length > 0 && !/^(slett alle logger|lagre logger til fil|vis)$/i.test(l));
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const { org, app, pages } = readAppConfig(args.appRepo);

  console.log(`App: ${org}/${app}`);
  console.log(`Pages (from Settings.json): ${pages.join(", ")}`);

  const token = await mintToken(args.localtestUrl, args.userId, args.partyId, args.authLevel);
  const { instanceOwnerPartyId, instanceGuid, currentTask } = await instantiate(args.gatewayUrl, org, app, args.partyId, token);
  console.log(`Instantiated: ${instanceOwnerPartyId}/${instanceGuid} (task: ${currentTask})`);

  const gatewayHost = new URL(args.gatewayUrl).hostname;
  const browser = await chromium.launch({ headless: !args.headed });
  const context = await browser.newContext();
  await context.addCookies([
    { name: "AltinnStudioRuntime", value: token, domain: gatewayHost, path: "/" },
    { name: "AltinnPartyId", value: String(instanceOwnerPartyId), domain: gatewayHost, path: "/" },
  ]);
  const page = await context.newPage();

  const findings = new Map(); // page name -> Set of log lines
  for (const pageName of pages) {
    const url = `${args.gatewayUrl}/${org}/${app}/#/instance/${instanceOwnerPartyId}/${instanceGuid}/${currentTask}/${pageName}`;
    await page.goto(url, { waitUntil: "networkidle" });
    await page.waitForTimeout(1000);
    const lines = await collectDevToolsLog(page);
    if (lines.length > 0) {
      findings.set(pageName, new Set(lines));
    }
  }

  await browser.close();

  if (findings.size === 0) {
    console.log("\nNo issues reported by the app-frontend developer-tools panel across any page. Clean.");
    process.exit(0);
  }

  console.log("\nIssues found:");
  for (const [pageName, lines] of findings) {
    console.log(`\n  ${pageName}:`);
    for (const line of lines) {
      console.log(`    - ${line}`);
    }
  }
  process.exit(1);
}

main().catch((err) => {
  console.error("Diagnostics run failed:", err.message);
  process.exit(2);
});
