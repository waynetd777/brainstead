// Copyright © 2026 Wayne Davies. Free software under the GNU General Public License, version 3 or later.
// See LICENSE for the full text.
// SPDX-License-Identifier: GPL-3.0-or-later

// The date selector used everywhere a date is chosen (no native date inputs: WebKit's are plain
// and unstyled). Type a date — 2026-10-05, today, tomorrow, fri, next week, +3d, 5 oct — and see
// what it means as you type, or pick it from the month below. Weeks start on Monday (en-GB).

import { useEffect, useMemo, useRef, useState } from "react";
import { Icon } from "./icons";
import { resolveDateWord } from "./md/dates";
import { localToday } from "./md/taskQuery";
import { Popover } from "./ui";

const parse = (s: string) => new Date(+s.slice(0, 4), +s.slice(5, 7) - 1, +s.slice(8, 10));
const iso = (d: Date) => localToday(d);
const addDays = (s: string, n: number) => {
  const d = parse(s);
  d.setDate(d.getDate() + n);
  return iso(d);
};
const addMonths = (s: string, n: number) => {
  const d = parse(s);
  const day = d.getDate();
  d.setDate(1);
  d.setMonth(d.getMonth() + n);
  const last = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
  d.setDate(Math.min(day, last));
  return iso(d);
};

/** The date typed text means (see resolveDateWord), or null. */
export function parseDateInput(text: string, today = localToday()): string | null {
  const t = text.trim();
  if (!t) return null;
  const d = resolveDateWord(t, today);
  if (!d) return null;
  const dt = parse(d);
  return Number.isNaN(dt.getTime()) || iso(dt) !== d ? null : d;
}

/** "Sat 5 Oct 2026". */
export const fmtLongDate = (d: string) =>
  parse(d).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", year: "numeric" });

/** The six weeks shown for the month holding `d`, Monday first. */
export function monthGrid(d: string): string[] {
  const first = parse(d);
  first.setDate(1);
  const back = (first.getDay() + 6) % 7;
  const start = iso(first);
  return Array.from({ length: 42 }, (_, i) => addDays(start, i - back));
}

const WEEKDAYS = ["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"];

/** A date field with its month: Enter or a click on a day picks; Escape calls `onCancel`. */
export function DatePicker({
  value,
  onPick,
  onCancel,
  label,
  autoFocus = true,
}: {
  value: string | null;
  onPick: (d: string) => void;
  onCancel?: () => void;
  label: string;
  autoFocus?: boolean;
}) {
  const today = localToday();
  const [text, setText] = useState(value ?? "");
  const typed = parseDateInput(text, today);
  // The day the grid highlights: what's typed, else the value, else today.
  const [cursor, setCursor] = useState(value ?? today);
  const [month, setMonth] = useState(value ?? today);
  const input = useRef<HTMLInputElement>(null);
  const grid = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (autoFocus) input.current?.focus();
  }, [autoFocus]);
  const days = useMemo(() => monthGrid(month), [month]);
  const m = parse(month);
  const title = m.toLocaleDateString("en-GB", { month: "long", year: "numeric" });

  const move = (n: number, by: "day" | "month" = "day") => {
    const next = by === "day" ? addDays(cursor, n) : addMonths(cursor, n);
    setCursor(next);
    setMonth(next);
    requestAnimationFrame(() => grid.current?.querySelector<HTMLElement>(`[data-day="${next}"]`)?.focus());
  };

  const onInputKey = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      e.preventDefault();
      if (typed) onPick(typed);
      else if (!text.trim()) onPick(cursor);
    } else if (e.key === "Escape" && onCancel) {
      e.preventDefault();
      e.stopPropagation();
      onCancel();
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      grid.current?.querySelector<HTMLElement>(`[data-day="${cursor}"]`)?.focus();
    }
  };
  const onGridKey = (e: React.KeyboardEvent) => {
    const k: Record<string, [number, "day" | "month"]> = {
      ArrowLeft: [-1, "day"],
      ArrowRight: [1, "day"],
      ArrowUp: [-7, "day"],
      ArrowDown: [7, "day"],
      PageUp: [-1, "month"],
      PageDown: [1, "month"],
    };
    if (k[e.key]) {
      e.preventDefault();
      move(...k[e.key]);
    } else if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      onPick(cursor);
    } else if (e.key === "Escape" && onCancel) {
      e.preventDefault();
      e.stopPropagation();
      onCancel();
    }
  };

  return (
    <div className="dpick">
      <div className="dpick-field">
        <Icon name="calendar" size={14} />
        <input
          ref={input}
          className="dpick-in"
          value={text}
          placeholder="tomorrow, fri, 5 oct…"
          aria-label={label}
          spellCheck={false}
          autoCorrect="off"
          autoCapitalize="off"
          onChange={(e) => {
            setText(e.target.value);
            const d = parseDateInput(e.target.value, today);
            if (d) {
              setCursor(d);
              setMonth(d);
            }
          }}
          onKeyDown={onInputKey}
        />
      </div>
      <div className={`dpick-preview ${text.trim() && !typed ? "bad" : ""}`} aria-live="polite">
        {typed ? fmtLongDate(typed) : text.trim() ? "Not a date yet" : "Type a date or pick a day"}
      </div>
      <div className="dpick-head">
        <button
          type="button"
          className="ibtn xs"
          aria-label="Previous month"
          title="Previous month"
          onClick={() => setMonth(addMonths(month, -1))}
        >
          <Icon name="back" size={13} />
        </button>
        <span className="dpick-title">{title}</span>
        <button type="button" className="ibtn xs" aria-label="Next month" title="Next month" onClick={() => setMonth(addMonths(month, 1))}>
          <Icon name="forward" size={13} />
        </button>
      </div>
      <div className="dpick-grid" role="grid" aria-label={title} ref={grid} onKeyDown={onGridKey}>
        {WEEKDAYS.map((w) => (
          <span key={w} className="dpick-wd" role="columnheader">
            {w}
          </span>
        ))}
        {days.map((d) => {
          const out = parse(d).getMonth() !== m.getMonth();
          const sel = d === (typed ?? value);
          return (
            <button
              key={d}
              type="button"
              role="gridcell"
              data-day={d}
              tabIndex={d === cursor ? 0 : -1}
              aria-selected={sel}
              aria-label={fmtLongDate(d)}
              title={`Pick ${fmtLongDate(d)}`}
              className={`dpick-day ${out ? "out" : ""} ${d === today ? "today" : ""} ${sel ? "on" : ""} ${d === cursor ? "cur" : ""}`}
              onClick={() => onPick(d)}
            >
              {parse(d).getDate()}
            </button>
          );
        })}
      </div>
      <div className="dpick-foot">
        <button type="button" className="btn ghost sm" title={`Pick today, ${fmtLongDate(today)}`} onClick={() => onPick(today)}>
          Today
        </button>
        <button
          type="button"
          className="btn ghost sm"
          title={`Pick tomorrow, ${fmtLongDate(addDays(today, 1))}`}
          onClick={() => onPick(addDays(today, 1))}
        >
          Tomorrow
        </button>
        {onCancel && (
          <button type="button" className="btn ghost sm" title="Close without changing the date" onClick={onCancel}>
            Cancel
          </button>
        )}
      </div>
    </div>
  );
}

/** A compact field showing a date that opens the picker below it, with a clear button. */
export function DateField({ value, onChange, label }: { value: string | null; onChange: (d: string | null) => void; label: string }) {
  const [at, setAt] = useState<DOMRect | null>(null);
  return (
    <span className="row dfield">
      <button
        type="button"
        className={`inp sm dfield-btn ${value ? "" : "empty"}`}
        aria-label={value ? `${label}: ${fmtLongDate(value)}` : label}
        title={value ? `${label}: ${fmtLongDate(value)}; click to change` : `Pick the ${label.toLowerCase()}`}
        onClick={(e) => setAt(e.currentTarget.getBoundingClientRect())}
      >
        <Icon name="calendar" size={13} />
        {value ? fmtLongDate(value) : "None"}
      </button>
      {value && (
        <button
          type="button"
          className="ibtn xs"
          aria-label={`Clear ${label.toLowerCase()}`}
          title={`Clear the ${label.toLowerCase()}`}
          onClick={() => onChange(null)}
        >
          <Icon name="x" size={11} />
        </button>
      )}
      {at && (
        <Popover anchor={at} onClose={() => setAt(null)} width={252}>
          <DatePicker
            value={value}
            label={label}
            onPick={(d) => {
              setAt(null);
              onChange(d);
            }}
            onCancel={() => setAt(null)}
          />
        </Popover>
      )}
    </span>
  );
}
