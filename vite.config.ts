// Copyright © 2026 Wayne Davies. Free software under the GNU General Public License, version 3 or later.
// See LICENSE for the full text.
// SPDX-License-Identifier: GPL-3.0-or-later

/// <reference types="vitest/config" />
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import process from "node:process";

const host = process.env.TAURI_DEV_HOST;

// https://vite.dev/config/
export default defineConfig(() => ({
  plugins: [react()],
  // Keep Rust errors visible in `tauri dev`.
  clearScreen: false,
  // Tauri expects a fixed port (the sibling apps use 1420 and 1430).
  server: {
    port: 1440,
    strictPort: true,
    host: host || false,
    hmr: host ? { protocol: "ws", host, port: 1441 } : undefined,
    watch: { ignored: ["**/src-tauri/**", "**/tests/fixtures/**"] },
  },
  test: {
    environment: "jsdom",
    include: ["src/**/*.test.{ts,tsx}", "extensions/**/*.test.js"],
  },
}));
