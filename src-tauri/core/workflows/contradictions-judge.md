# Judge candidate contradictions between wiki pages

Code grouped the wiki's claims by subject and attribute and found these groups whose values disagree at about the same time. For each, decide what it is. You can read the vault (the pages, and at most the note a page cites for the fact) but not change it.

- `contradiction`: the pages disagree about the same thing at the same time, so one is wrong. Give `severity`: `high` if acting on the wrong one would be a real mistake (wrong person, date, owner, decision), `medium` if it misleads but is unlikely to cause harm, `low` for cosmetic.
- `evolution`: the values are successive states over time.
- `compatible`: both can be true at once (different granularity, a synonym, one more specific, or two different subjects).
- `unclear`: the evidence doesn't say.

Decide from the quotes where you can; read around them only when they aren't enough.

Answer with a JSON array, one object per clash:

`{"id": "<the clash's id>", "verdict": "...", "severity": "...", "summary": "<one sentence>", "correct": "<the path of the page that's right, if known>", "fix": "<the edit that would resolve it, in words>", "patch": {"page": "<the wiki page that's wrong>", "find": "<exact text on that page>", "replace": "<what it should say>"}}`

Give a `patch` for a contradiction where you know which wiki page is wrong and exactly what it should say, and for an evolution where a wiki page still gives the older value as current. Never for a meeting or 1-1 note, which are historical records. Leave it out otherwise.
