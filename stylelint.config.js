// Copyright © 2026 Wayne Davies. Free software under the GNU General Public License, version 3 or later.
// See LICENSE for the full text.
// SPDX-License-Identifier: GPL-3.0-or-later

// Lint rules for src/styles.css: `make lint` runs this, and Prettier handles layout.
export default {
  extends: ["stylelint-config-standard"],
  rules: {
    // Class names here are short, all-lowercase words (.navi, .srow, .tlspace), not kebab-case.
    "selector-class-pattern": null,
    // -webkit-user-select and -webkit-font-smoothing are what WKWebView reads.
    "property-no-vendor-prefix": null,
    // Layout is Prettier's; blank lines between rules aren't this stylesheet's style.
    "rule-empty-line-before": null,
    // The sheet is ordered by component, so it flags unrelated selectors (.sect:hover svg and .pr svg).
    "no-descending-specificity": null,
    // Font names in the --sans, --display and --mono stacks keep their own capitals.
    "value-keyword-case": ["lower", { ignoreProperties: ["/^--/"] }],
  },
};
