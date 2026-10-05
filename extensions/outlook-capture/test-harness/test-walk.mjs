// Copyright © 2026 Wayne Davies. Free software under the GNU General Public License, version 3 or later.
// See LICENSE for the full text.
// SPDX-License-Identifier: GPL-3.0-or-later

// Can the batch walk click a row that OWA has virtualised away, and does it
// settle only when the reading pane really shows that message?
//
// Regression cover for bug-158 (settle detection) and bug-160 (virtualisation).
import { check, extensionSource, finish, fixtureUrl, launch, liftFunction } from "./harness.mjs";

// Lifted from background.js: the walk moved into the service worker so a run
// survives the popup closing.
const FN = liftFunction(extensionSource("background.js"), "async function openRowAndSettle");

const browser = await launch();
const page = await browser.newPage();
await page.setViewport({ width: 700, height: 500 });
await page.goto(fixtureUrl("fake-list-with-pane.html"));

const run = (convid, prev, hint) =>
  page.evaluate(
    `(async () => { ${FN}; return openRowAndSettle(${JSON.stringify(convid)}, ${JSON.stringify(prev)}, ${JSON.stringify(hint)}); })()`,
  );
const clicks = () => page.evaluate(() => window.__clicks);

let r = await run("conv-0", "", null);
check("opens a row that is on screen", r.ok === true && r.hasPaneText === true, JSON.stringify(r).slice(0, 80));

check(
  "conv-59 is genuinely absent from the DOM to begin with",
  (await page.evaluate(() => !!document.querySelector('[data-convid="conv-59"]'))) === false,
);
r = await run("conv-59", r.signature, 4160);
check("finds and opens a row below the fold using the scrollTop hint", r.ok === true, JSON.stringify(r).slice(0, 80));
check("clicked the right row", (await clicks()).at(-1) === 59, (await clicks()).join(","));
check(
  "the reading pane really shows that message",
  (await page.evaluate(() => document.getElementById("pane").textContent)).includes("message 59"),
);

r = await run("conv-33", r.signature, 99999);
check("recovers from a stale hint by sweeping the list", r.ok === true, JSON.stringify(r).slice(0, 80));
check("clicked row 33", (await clicks()).at(-1) === 33);

const t0 = Date.now();
r = await run("conv-does-not-exist", r.signature, null);
check("a row that does not exist fails cleanly", r.ok === false && r.reason === "row-not-found", JSON.stringify(r));
check("and fails without hanging", Date.now() - t0 < 20000, `${Date.now() - t0}ms`);

await browser.close();
finish();
