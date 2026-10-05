# Answer from the vault

Answer the question below from the user's vault, with citations, using Brainstead's tools.

1. **Pick where to look from the question.** What something is (a person, project, decision, concept: "what's the status of X", "who owns Y") lives in the wiki: search with `layers: ["wiki"]`. What happened or was said, and when ("what did I work on this week", "when did Maya mention the pilot") lives in the notes: search `["wiki", "notes"]` with `since` set to the start of the window. Something captured but not yet in the wiki: add `"sources"`. Work out real dates for "this week" or "the past fortnight" from today's date before searching, and say which window you used.
2. **Check for something newer.** A wiki page is only as current as its last update. For a status, a date, an owner or a decision, also search the notes and sources (`layers: ["notes", "sources"]`, `since` the page's `updated:` date when it has one) for anything that changes it, and say when they do ("the page says 14 November; the 28 September steerco minutes moved it to 28 November").
3. **Read only what you need.** Wiki pages keep their latest position in `## Current state`: read that section with `read_section` first, and stop if it answers. Read dated sections, or `## Archive` at the bottom, only for history. `resolve_entity` finds which page a name means, by name, alias or a close spelling.
4. **For a time-scoped question, prefer the summaries.** `Me. Daily Summaries - YYYY-MM` and `Me. Weekly Summaries - YYYY-MM` (`Me. Daily Reviews - …` and `Me. Weekly Reviews - …` before October 2026) already sum up each day and week; read their blocks before a fortnight of notes, and say when a day in the window has no summary.
5. **Answer with citations**: `[[Page]]` after each point, `[[Page#Heading]]` for a section, `[[Source.pdf#page=6]]` for a PDF page. Say plainly when the vault has nothing on a point.
6. If the answer is good and not trivial, say it could be filed as a wiki page (the user can use "File this answer").

If no search comes back with anything, try other words (a name's alias, the project's other name) before saying the vault has nothing.
