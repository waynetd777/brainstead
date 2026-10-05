// Copyright © 2026 Wayne Davies. Free software under the GNU General Public License, version 3 or later.
// See LICENSE for the full text.
// SPDX-License-Identifier: GPL-3.0-or-later

// Does list-extractor.js find checked rows that OWA has virtualised away?
//
// Regression cover for bug-160: the scan used to read the document once, so a
// selection made across a scroll silently lost everything below the fold.
import { check, extensionSource, finish, fixtureUrl, launch } from "./harness.mjs";

const SRC = extensionSource("list-extractor.js");
const browser = await launch();

for (const withAriaCount of [false, true]) {
  const page = await browser.newPage();
  await page.setViewport({ width: 600, height: 500 });
  await page.goto(fixtureUrl("fake-list.html"));
  // The fixture reads this flag when it renders rows.
  await page.evaluate((f) => {
    window.__withAriaCount = f;
  }, withAriaCount);
  await page.evaluate(() => document.getElementById("outer").dispatchEvent(new Event("scroll")));

  console.log(`\n--- aria "N conversations selected" present: ${withAriaCount} ---`);
  const checkedBefore = await page.evaluate(() => document.querySelectorAll('[role="option"][aria-selected="true"]').length);
  check("the naive single read misses rows below the fold", checkedBefore < 5, `(saw ${checkedBefore} of 5)`);

  const result = await page.evaluate(SRC);
  const ids = result.rows.map((r) => r.convid);
  check("scan finds all 5 checked rows", result.rows.length === 5, `(got ${result.rows.length})`);
  check("in list order", JSON.stringify(ids) === JSON.stringify(["conv-0", "conv-1", "conv-14", "conv-33", "conv-59"]), ids.join(","));
  check("subject comes off the row", result.rows[2]?.subject === "Subject 14", JSON.stringify(result.rows[2]?.subject));
  check(
    "every row records a scrollTop hint for the walk",
    result.rows.every((r) => typeof r.scrollTop === "number"),
    result.rows.map((r) => r.scrollTop).join(","),
  );
  check("reports that it scanned", result.scanned === true);
  check("surfaces aria-setsize", result.setSize === 60, String(result.setSize));
  if (withAriaCount) {
    check(
      "early-exits once OWA's own count is satisfied",
      result.ariaCount === 5 && result.passes <= 40,
      `ariaCount=${result.ariaCount} passes=${result.passes}`,
    );
  }
  check("leaves the scroll position where the user had it", (await page.evaluate(() => document.getElementById("outer").scrollTop)) === 0);

  await page.evaluate(() => {
    document.getElementById("outer").scrollTop = 1200;
  });
  await new Promise((r) => setTimeout(r, 200));
  await page.evaluate(SRC);
  const restored = await page.evaluate(() => document.getElementById("outer").scrollTop);
  check("restores a mid-list scroll position too", restored === 1200, `scrollTop=${restored}`);
  await page.close();
}

await browser.close();
finish();
