# Extract checkable facts from wiki pages

You are reading wiki pages for a contradiction check. You don't compare pages: you only list each page's own facts, and code compares them. You can't change any file.

For each page below, list 5 to 25 specific, checkable claims (fewer only when the page has none), as a JSON array, one object per claim:

`{"page": "<path exactly as given>", "subject": "...", "attribute": "...", "value": "...", "as_of": "...", "quote": "..."}`

- `subject`: who or what the fact is about. When it's in the known subjects (by name or alias), use the page name exactly as written there.
- `attribute`: one of role, team, reports_to, employer, location, status, owner, sponsor, start_date, end_date, go_live_date, deadline, budget, headcount, vendor, version, decision, or `other:<snake_case>` when none fits. A number is always `other:<thing_counted>`, such as `other:tools_built`.
- `value`: the fact itself, ten words at most.
- `as_of`: when the fact held, as YYYY, YYYY-MM or YYYY-MM-DD: from the heading it sits under ("## Jun 2026" means 2026-06), a date in the sentence, or the dated note it cites. Empty when there's no date.
- `quote`: the page's own words, copied exactly. A quote that isn't in its page is refused.
- Favour the facts most likely to be stated on more than one page: people's roles, teams and managers; projects' status, owner, sponsor, vendor and dates; decisions and their numbers.
- Only single-valued facts. Skip opinions, advice, lists of members or tools, and properties other than `description`.

Answer with the JSON array only. A page with no claims simply has none in it.
