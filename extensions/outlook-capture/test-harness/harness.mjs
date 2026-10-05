// Copyright © 2026 Wayne Davies. Free software under the GNU General Public License, version 3 or later.
// See LICENSE for the full text.
// SPDX-License-Identifier: GPL-3.0-or-later

// Shared plumbing for the manual OWA harness tests.
//
// These drive a REAL Chrome (the DOM behaviour under test needs layout:
// scrollHeight, clientHeight and innerText are all meaningless in jsdom), which
// is why they aren't part of `npm test`. Run them by hand after OWA changes, or
// when touching the scan / walk logic:
//
//   node extensions/outlook-capture/test-harness/test-scan.mjs
//   node extensions/outlook-capture/test-harness/test-walk.mjs
//
// puppeteer-core is not a dependency of this repo. It resolves from the
// globally-installed `openwolf` package if present; otherwise set PUPPETEER_DIR
// to any directory containing puppeteer-core. Chrome comes from CHROME_PATH, or
// the platform default below.
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
export const EXTENSION_DIR = join(here, "..");

const PUPPETEER_CANDIDATES = [
  process.env["PUPPETEER_DIR"] && join(process.env["PUPPETEER_DIR"], "puppeteer-core/lib/esm/puppeteer/puppeteer-core.js"),
  "/usr/local/lib/node_modules/openwolf/node_modules/puppeteer-core/lib/esm/puppeteer/puppeteer-core.js",
  "/opt/homebrew/lib/node_modules/openwolf/node_modules/puppeteer-core/lib/esm/puppeteer/puppeteer-core.js",
  join(EXTENSION_DIR, "../../node_modules/puppeteer-core/lib/esm/puppeteer/puppeteer-core.js"),
].filter(Boolean);

const CHROME_CANDIDATES = [
  process.env["CHROME_PATH"],
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
  "/usr/bin/google-chrome",
  "/usr/bin/chromium",
].filter(Boolean);

function firstExisting(paths, what, hint) {
  const found = paths.find((p) => existsSync(p));
  if (!found) {
    console.error(`Could not find ${what}. Tried:\n${paths.map((p) => "  " + p).join("\n")}\n${hint}`);
    process.exit(2);
  }
  return found;
}

export async function launch() {
  const puppeteerPath = firstExisting(
    PUPPETEER_CANDIDATES,
    "puppeteer-core",
    "Set PUPPETEER_DIR to a directory containing puppeteer-core.",
  );
  const executablePath = firstExisting(CHROME_CANDIDATES, "Chrome", "Set CHROME_PATH to your Chrome binary.");
  const { default: puppeteer } = await import(pathToFileURL(puppeteerPath).href);
  return puppeteer.launch({ executablePath, headless: "shell", args: ["--no-sandbox"] });
}

/** file:// URL for one of the fake-OWA pages next to this file. */
export function fixtureUrl(name) {
  return pathToFileURL(join(here, name)).href;
}

/** The shipped source of an extension script, so tests never fork a copy. */
export function extensionSource(name) {
  return readFileSync(join(EXTENSION_DIR, name), "utf8");
}

/**
 * Lift a named function out of popup.js by source slicing. The injected
 * functions are deliberately self-contained (chrome.scripting serialises them),
 * which is exactly what makes this safe.
 */
export function liftFunction(source, signature, until) {
  const start = source.indexOf(signature);
  if (start === -1) {
    throw new Error(`could not find ${signature} — has the source been restructured?`);
  }
  // No `until` means the function runs to the end of the file.
  const end = until ? source.indexOf(until, start) : source.length;
  if (end === -1 || end < start) {
    throw new Error(`could not find the end marker after ${signature}`);
  }
  const fn = source.slice(start, end).trim();
  if (!fn.startsWith(signature)) throw new Error(`lifted the wrong text for ${signature}`);
  return fn;
}

let failures = 0;
export function check(name, cond, detail = "") {
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${detail ? "  " + detail : ""}`);
  if (!cond) failures++;
}
export function finish() {
  console.log(failures === 0 ? "\nALL CHECKS PASSED" : `\n${failures} CHECK(S) FAILED`);
  process.exit(failures === 0 ? 0 : 1);
}
