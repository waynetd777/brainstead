// Copyright © 2026 Wayne Davies. Free software under the GNU General Public License, version 3 or later.
// See LICENSE for the full text.
// SPDX-License-Identifier: GPL-3.0-or-later

// Keeps one failing part of the window (a note that won't draw, a screen that throws) from
// blanking the whole app: what failed says so in its place, and the rest goes on working.

import { Component, ErrorInfo, ReactNode } from "react";
import { nav } from "./nav";
import { toast } from "./Toast";

interface Props {
  /** What to show instead, given the error and a way to try again. */
  fallback: (error: Error, retry: () => void) => ReactNode;
  /** Starts afresh when this changes (another note, another screen). */
  resetKey?: unknown;
  children: ReactNode;
}

interface State {
  error: Error | null;
  key: unknown;
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null, key: this.props.resetKey };

  static getDerivedStateFromError(error: unknown): Partial<State> {
    return { error: error instanceof Error ? error : new Error(String(error)) };
  }

  static getDerivedStateFromProps(props: Props, state: State): Partial<State> | null {
    return Object.is(props.resetKey, state.key) ? null : { error: null, key: props.resetKey };
  }

  componentDidCatch(error: unknown, info: ErrorInfo) {
    console.error("Brainstead: a part of the window failed to draw", error, info.componentStack);
  }

  render() {
    if (this.state.error) return this.props.fallback(this.state.error, () => this.setState({ error: null }));
    return this.props.children;
  }
}

/** A screen that failed, in the screen's place. */
export function ScreenError({ error, retry }: { error: Error; retry: () => void }) {
  const copy = () =>
    void navigator.clipboard
      .writeText(`${error.name}: ${error.message}\n${error.stack ?? ""}`.trim())
      .then(() => toast("Error details copied", undefined, "ok"))
      .catch(() => toast("Couldn't copy the error details", undefined, "bad"));
  return (
    <main className="main">
      <div className="body center">
        <div className="soon">
          <h1 className="h2">This screen hit a problem</h1>
          <p className="muted">{error.message}</p>
          <div className="row">
            <button type="button" className="btn pri" title="Draw this screen again" onClick={retry}>
              Try again
            </button>
            <button type="button" className="btn" title="Leave this screen and go to Today" onClick={() => nav.go("today")}>
              Go to Today
            </button>
            <button type="button" className="btn" title="Copy the error and where it happened, to paste into a bug report" onClick={copy}>
              Copy error details
            </button>
          </div>
        </div>
      </div>
    </main>
  );
}
