/**
 * shot.mjs — screenshot harness.
 *
 * Exists so design work can be *looked at* instead of guessed at. Without this
 * the whole UI was being written blind: the map stacking bug that hid every
 * panel would have been caught in one frame here.
 *
 * Usage:
 *   node scripts/shot.mjs login                     → login page
 *   node scripts/shot.mjs dash admin                → dashboard as a role (needs backend)
 *   node scripts/shot.mjs login --w 1440 --h 900
 *
 * Writes to scripts/shots/<name>.png and prints any console/page errors, so a
 * runtime exception can never hide behind a pretty screenshot.
 */
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, "shots");
mkdirSync(OUT, { recursive: true });

const argv = process.argv.slice(2);
const mode = argv[0] || "login";
const role = argv[1] && !argv[1].startsWith("--") ? argv[1] : "admin";
const flag = (n, d) => {
  const i = argv.indexOf(`--${n}`);
  return i === -1 ? d : Number(argv[i + 1]);
};

const W = flag("w", 1600);
const H = flag("h", 1000);
const WAIT = flag("wait", 2600); // let entrance animation settle before capture
const BASE = process.env.BASE_URL || "http://localhost:3000";

const CREDS = { admin: "admin", authority: "officer", fleet: "driver" };

const browser = await chromium.launch();
const page = await browser.newPage({
  viewport: { width: W, height: H },
  deviceScaleFactor: 2,
  colorScheme: "dark",
});

const problems = [];
page.on("console", (m) => {
  if (m.type() === "error") problems.push(`console.error: ${m.text()}`);
});
page.on("pageerror", (e) => problems.push(`pageerror: ${e.message}`));

let name = mode;

if (mode === "login") {
  await page.goto(`${BASE}/login`, { waitUntil: "networkidle" });
} else {
  // Seed the session the way the app does, then land straight on the dashboard.
  await page.goto(`${BASE}/login`, { waitUntil: "networkidle" });
  await page.fill('input[autocomplete="username"]', CREDS[role] || "admin");
  await page.fill('input[autocomplete="current-password"]', "password");
  await Promise.all([
    page.waitForURL((u) => !u.pathname.includes("login"), { timeout: 15000 }).catch(() => {}),
    page.click('button[type="submit"]'),
  ]);
  await page.waitForTimeout(2500);
  name = `dash-${role}`;

  // Optional: --nav "Analytics" clicks a sidebar destination before the shot,
  // so every view can be reviewed, not just the landing one.
  const navIdx = argv.indexOf("--nav");
  if (navIdx !== -1) {
    const label = argv[navIdx + 1];
    await page.locator(`nav button:has-text("${label}")`).first().click();
    await page.waitForTimeout(1200);
    name = `dash-${role}-${label.toLowerCase().replace(/\s+/g, "-")}`;
  }

  // Optional: --tab "User management" clicks a tab inside the view.
  const tabIdx = argv.indexOf("--tab");
  if (tabIdx !== -1) {
    const label = argv[tabIdx + 1];
    await page.locator(`button:has-text("${label}")`).first().click();
    await page.waitForTimeout(1000);
    name += `-${label.toLowerCase().replace(/\s+/g, "-")}`;
  }
}

await page.waitForTimeout(WAIT);
const file = join(OUT, `${name}.png`);
await page.screenshot({ path: file });
await browser.close();

console.log(`shot  → ${file}  (${W}x${H} @2x)`);
if (problems.length) {
  console.log(`\n${problems.length} page problem(s):`);
  problems.slice(0, 12).forEach((p) => console.log("  " + p));
} else {
  console.log("no console/page errors");
}
