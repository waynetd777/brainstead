// Copyright © 2026 Wayne Davies. Free software under the GNU General Public License, version 3 or later.
// See LICENSE for the full text.
// SPDX-License-Identifier: GPL-3.0-or-later

import { describe, expect, it } from "vitest";
import { imageSize, imgTag, parseWikilink, setImageWidth, wikiLabel } from "./wikilinks";

describe("wikilinks", () => {
  it("reads every shape the index reads", () => {
    expect(parseWikilink(false, "Orbit App")).toEqual({ target: "Orbit App", embed: false, alias: undefined });
    expect(parseWikilink(false, "Orbit App|the app")?.alias).toBe("the app");
    expect(parseWikilink(false, "Orbit App#Current state")?.heading).toBe("Current state");
    expect(parseWikilink(false, "Orbit App#^q3")?.block).toBe("q3");
    expect(parseWikilink(true, "pic.png")).toMatchObject({ target: "pic.png", embed: true });
    expect(parseWikilink(false, "#Local")).toMatchObject({ target: "", heading: "Local" });
    expect(parseWikilink(false, "A\\|b")?.alias).toBe("b");
    expect(parseWikilink(false, " ")).toBeNull();
  });
  it("labels links as other editors show them", () => {
    expect(wikiLabel({ target: "wiki/Orbit App", embed: false })).toBe("Orbit App");
    expect(wikiLabel({ target: "Orbit App", heading: "State", embed: false })).toBe("Orbit App › State");
    expect(wikiLabel({ target: "", heading: "Local", embed: false })).toBe("Local");
    expect(wikiLabel({ target: "X", alias: "shown", embed: false })).toBe("shown");
  });
});

describe("image sizes", () => {
  it("reads the size from an image's label, as Obsidian writes it", () => {
    expect(imageSize("400")).toEqual({ alt: "", width: 400, height: undefined });
    expect(imageSize("400x300")).toEqual({ alt: "", width: 400, height: 300 });
    expect(imageSize("A chart|400")).toEqual({ alt: "A chart", width: 400, height: undefined });
    expect(imageSize("A chart")).toEqual({ alt: "A chart" });
    expect(imageSize("2026 plan")).toEqual({ alt: "2026 plan" });
    expect(imageSize(undefined)).toEqual({ alt: "" });
  });

  it("writes a width into either kind of image, keeping its alt text", () => {
    expect(setImageWidth("![[pic.png]]", 399.6)).toBe("![[pic.png|400]]");
    expect(setImageWidth("![[pic.png|400x300]]", 250)).toBe("![[pic.png|250]]");
    expect(setImageWidth("![[pic.png|A chart|400]]", 250)).toBe("![[pic.png|A chart|250]]");
    expect(setImageWidth("![[pic.png|A chart]]", 250)).toBe("![[pic.png|A chart|250]]");
    expect(setImageWidth("![[pic.png\\|400]]", 250)).toBe("![[pic.png\\|250]]");
    expect(setImageWidth("![A chart](images/pic.png)", 250)).toBe("![A chart|250](images/pic.png)");
    expect(setImageWidth("![|400](pic.png)", 250)).toBe("![250](pic.png)");
    expect(setImageWidth('<img height="287" width="717" src="/api/vault-assets/images/p.png" />', 400)).toBe(
      '<img width="400" src="/api/vault-assets/images/p.png" />',
    );
    expect(setImageWidth("[[Note]]", 250)).toBeNull();
  });

  it("reads a raw <img> tag", () => {
    expect(imgTag('<img height="287" width="717" src="/api/vault-assets/images/p.png" />')).toEqual({
      src: "/api/vault-assets/images/p.png",
      label: "717x287",
    });
    expect(imgTag("<img alt='A chart' src=c.png>")).toEqual({ src: "c.png", label: "A chart" });
    expect(imgTag("<img alt='x'>")).toBeNull();
    expect(imgTag("<b>bold</b>")).toBeNull();
  });
});
