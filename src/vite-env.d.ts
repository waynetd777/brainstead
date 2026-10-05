// Copyright © 2026 Wayne Davies. Free software under the GNU General Public License, version 3 or later.
// See LICENSE for the full text.
// SPDX-License-Identifier: GPL-3.0-or-later

/// <reference types="vite/client" />

// moment's locales register themselves on import and export nothing typed.
declare module "moment/locale/*";
