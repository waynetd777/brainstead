// Copyright © 2026 Wayne Davies. Free software under the GNU General Public License, version 3 or later.
// See LICENSE for the full text.
// SPDX-License-Identifier: GPL-3.0-or-later

// Brainstead's product page: scroll reveals, scroll-linked screenshots and the auto-cycling stacks.
(() => {
  const still = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v));

  // Fade things in as they scroll into view.
  const reveals = new IntersectionObserver(
    (entries) => {
      for (const e of entries)
        if (e.isIntersecting) {
          e.target.classList.add("in");
          reveals.unobserve(e.target);
        }
    },
    { rootMargin: "0px 0px -8% 0px" },
  );
  document.querySelectorAll(".reveal").forEach((el) => reveals.observe(el));

  // Split the statement into words that light up as you scroll past it.
  const words = [];
  document.querySelectorAll(".words").forEach((p) => {
    p.classList.remove("reveal");
    p.classList.add("in");
    const split = (node) => {
      for (const child of [...node.childNodes]) {
        if (child.nodeType === Node.TEXT_NODE) {
          const frag = document.createDocumentFragment();
          for (const part of child.textContent.split(/(\s+)/)) {
            if (!part) continue;
            if (/^\s+$/.test(part)) {
              frag.append(part);
              continue;
            }
            const w = document.createElement("span");
            w.className = "w";
            w.textContent = part;
            words.push(w);
            frag.append(w);
          }
          child.replaceWith(frag);
        } else split(child);
      }
    };
    split(p);
  });

  // Each GTD step swaps the sticky screenshot.
  const steps = [...document.querySelectorAll(".step")];
  const storyShots = [...document.querySelectorAll(".story .stack > picture")];
  const dots = [...document.querySelectorAll(".story .dots i")];
  const show = (list, i) => list.forEach((el, j) => el.classList.toggle("on", i === j));
  const stepObs = new IntersectionObserver(
    (entries) => {
      for (const e of entries) {
        if (!e.isIntersecting) continue;
        const i = Number(e.target.dataset.step);
        show(steps, i);
        show(storyShots, i);
        show(dots, i);
      }
    },
    { rootMargin: "-45% 0px -45% 0px" },
  );
  steps.forEach((s) => stepObs.observe(s));
  steps[0]?.classList.add("on");

  // Notes: View and Edit take turns until someone picks one.
  const seg = document.querySelector(".seg");
  const modeShots = [...document.querySelectorAll(".modes > picture")];
  let mode = 0,
    timer = null;
  const setMode = (m) => {
    mode = m;
    seg.dataset.mode = m;
    seg.querySelectorAll("button").forEach((b, i) => b.setAttribute("aria-selected", String(i === m)));
    show(modeShots, m);
  };
  seg.querySelectorAll("button").forEach((b) =>
    b.addEventListener("click", () => {
      clearInterval(timer);
      timer = "stopped";
      setMode(Number(b.dataset.mode));
    }),
  );
  if (!still) {
    new IntersectionObserver(
      ([e]) => {
        if (timer === "stopped") return;
        clearInterval(timer);
        timer = e.isIntersecting ? setInterval(() => setMode(1 - mode), 3200) : null;
      },
      { threshold: 0.4 },
    ).observe(document.querySelector(".modes"));
  }

  // Quick capture types a task, and each token turns into a chip as it's finished.
  const capText = document.querySelector(".cap-text");
  const captures = [
    [["Call Sam about the launch date "], ["due: fri", "date", "Fri"], [" "], ["@calls", "ctx", "@calls"]],
    [["Draft the comms plan "], ["#orbit", "tag", "#orbit"], [" "], ["defer: +3d", "date", "Mon"]],
    [["Book the room for the steerco "], ["@office", "ctx", "@office"], [" "], ["due: tue", "date", "Tue"]],
  ];
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const typeCaptures = async () => {
    for (let n = 0; ; n = (n + 1) % captures.length) {
      capText.textContent = "";
      for (const [text, kind, label] of captures[n]) {
        const run = document.createElement("span");
        capText.append(run);
        for (const ch of text) {
          run.textContent += ch;
          await sleep(45 + Math.random() * 40);
        }
        if (kind) {
          await sleep(160);
          const chip = document.createElement("span");
          chip.className = `chip ${kind}`;
          chip.textContent = label;
          run.replaceWith(chip);
        }
      }
      await sleep(2600);
    }
  };

  // The Terminal card types its command, then shows the answer.
  const term = document.querySelector(".term");
  const termType = term.querySelector(".t-type");
  const typeTerm = async () => {
    for (;;) {
      term.classList.remove("done");
      termType.textContent = "";
      await sleep(600);
      for (const ch of termType.dataset.text) {
        termType.textContent += ch;
        await sleep(38 + Math.random() * 30);
      }
      await sleep(350);
      term.classList.add("done");
      await sleep(4200);
    }
  };

  if (still) {
    words.forEach((w) => (w.style.opacity = 1));
    capText.innerHTML = 'Call Sam about the launch date <span class="chip date">Fri</span> <span class="chip ctx">@calls</span>';
    termType.textContent = termType.dataset.text;
    term.classList.add("done");
    return;
  }

  // Start each typing loop the first time its card comes into view.
  const startOnce = (el, fn) => {
    const o = new IntersectionObserver(
      ([e]) => {
        if (e.isIntersecting) {
          o.disconnect();
          fn();
        }
      },
      { threshold: 0.5 },
    );
    o.observe(el);
  };
  startOnce(capText.closest(".card"), typeCaptures);
  startOnce(term, typeTerm);

  // Scroll-linked motion, worked out once a frame.
  const heroWin = document.querySelector("[data-scale]");
  const graph = document.querySelector("[data-zoom] img");
  const statement = document.querySelector(".statement");
  let ticking = false;
  const frame = () => {
    ticking = false;
    const vh = innerHeight;

    // The hero window tilts up and grows to full size.
    const r = heroWin.getBoundingClientRect();
    const p = clamp(1 - (r.top - vh * 0.15) / (vh * 0.7));
    heroWin.style.transform = `rotateX(${(1 - p) * 16}deg) scale(${0.86 + p * 0.14})`;

    // The graph pushes in slowly as it passes.
    const g = graph.getBoundingClientRect();
    const gp = clamp((vh - g.top) / (vh + g.height));
    graph.style.transform = `scale(${1.12 + gp * 0.16}) translate3d(0, ${(gp - 0.5) * -4}%, 0)`;

    // The statement lights up word by word.
    const s = statement.getBoundingClientRect();
    const sp = clamp((vh * 0.85 - s.top) / (s.height + vh * 0.2));
    const lit = sp * words.length * 1.15;
    words.forEach((w, i) => (w.style.opacity = String(0.18 + 0.82 * clamp(lit - i))));
  };
  const onScroll = () => {
    if (!ticking) {
      ticking = true;
      requestAnimationFrame(frame);
    }
  };
  addEventListener("scroll", onScroll, { passive: true });
  addEventListener("resize", onScroll);
  frame();
})();
