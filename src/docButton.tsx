// Copyright © 2026 Wayne Davies. Free software under the GNU General Public License, version 3 or later.
// See LICENSE for the full text.
// SPDX-License-Identifier: GPL-3.0-or-later

// Buttons that open a document named in a record kept from before (a run, a capture, a log line,
// a change): the document may since have been renamed or deleted, so the button is disabled and
// its tooltip says so.

import { ReactNode, useEffect, useState } from "react";
import { api } from "./api";
import { openDoc } from "./nav";
import { useVaultVersion } from "./state";

/** Which of `paths` are gone from the vault, checked again when the vault changes. */
export function useGone(paths: (string | null | undefined)[]): (path: string | null | undefined) => boolean {
  const v = useVaultVersion();
  const want = [...new Set(paths.filter((p): p is string => !!p))].sort();
  const key = want.join("\n");
  const [gone, setGone] = useState<Set<string>>(new Set());
  useEffect(() => {
    if (!want.length) return setGone(new Set());
    let live = true;
    void api
      .pathsExist(want)
      .then((ok) => live && setGone(new Set(want.filter((_, i) => !ok[i]))))
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [key, v]); // eslint-disable-line react-hooks/exhaustive-deps
  return (p) => !!p && gone.has(p);
}

export const goneTip = (path: string) => `${path} isn't in the vault any more: it was renamed, moved or deleted`;

/** A button that opens `path`, or when it's gone, the same button disabled with the reason. */
export function DocButton({
  path,
  gone,
  className,
  title,
  onClick,
  children,
}: {
  path: string;
  gone: boolean;
  className?: string;
  title?: string;
  onClick?: () => void;
  children: ReactNode;
}) {
  const b = (
    <button
      type="button"
      className={className}
      disabled={gone}
      title={gone ? undefined : (title ?? `Open ${path}`)}
      onClick={onClick ?? (() => openDoc(path))}
    >
      {children}
    </button>
  );
  // Disabled buttons get no pointer events in WebKit, so the tooltip goes on a wrapper.
  return gone ? (
    <span className="gonewrap" title={goneTip(path)}>
      {b}
    </span>
  ) : (
    b
  );
}

/** Whether the one document `path` is gone. */
export function useIsGone(path: string | null | undefined): boolean {
  return useGone([path])(path);
}
