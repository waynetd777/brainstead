// Copyright © 2026 Wayne Davies. Free software under the GNU General Public License, version 3 or later.
// See LICENSE for the full text.
// SPDX-License-Identifier: GPL-3.0-or-later

//! `brainstead-mcp [--data <app data folder>]`: Brainstead's MCP server on stdin and stdout, for a
//! CLI in a terminal. The app runs the same server as `Brainstead --mcp`.

fn main() {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let data = std::env::var_os("BRAINSTEAD_DATA").filter(|d| !d.is_empty()).map(std::path::PathBuf::from).unwrap_or_else(|| {
        std::path::PathBuf::from(std::env::var_os("HOME").unwrap_or_default()).join("Library/Application Support/Brainstead")
    });
    std::process::exit(brainstead_mcp::main_with(&args, data));
}
