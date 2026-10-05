> **This is a system note** — Registry of which version of each governing document is authoritative. The `/doc-check` skill reads the table below instead of guessing from filenames, so that "does this align with the operating model?" is always answered against the version actually in force, and so the answer can name that version when someone asks which one was used.
>
> One row per document **version**. Keep the superseded rows: knowing an older version is still sitting in `sources/` is what lets a review say "do not cite this one".
>
> | Column | Meaning |
> |---|---|
> | `key` | Short lowercase handle for the document family. All versions of one document share a key. |
> | `title` | Full name, as you would write it in a reply. |
> | `version` | Whatever the document itself calls it - `v2.3`, `2026-07`, `Draft 1`. |
> | `status` | `canonical` (in force - exactly one per key), `draft` (not yet in force), or `superseded` (do not cite). |
> | `path` | Vault-relative (`sources/…`), `~`-prefixed, or absolute. |
> | `aliases` | Comma-separated other names you or a colleague might use. Optional. |
>
> Check the table after editing it with `python3 scripts/canonical_docs.py --check`. That reports the mistakes that make a citation wrong: two `canonical` rows for one key, a key with none, an alias claimed by two documents, and any row whose file has moved or been renamed.

An example of what a filled-in family looks like - three versions of one document, one of them in force:

```
| key | title | version | status | path | aliases |
|---|---|---|---|---|---|
| om | Example Operating Model | v2.3 | canonical | sources/example-om-v2-3.pdf | OM, operating model |
| om | Example Operating Model | v2.4 | draft | ~/Downloads/example-om-v2.4-redline.docx | |
| om | Example Operating Model | v2.2 | superseded | sources/example-om-v2-2.pdf | |
```

Add your rows to this table:

| key | title | version | status | path | aliases |
|---|---|---|---|---|---|
| roadmap | Orbit App Roadmap | 2026-09-18 | canonical | sources/Roadmap Update 2026-09-18.md | roadmap |
| roadmap | Orbit App Roadmap | 2026-08 | superseded | sources/Roadmap Update 2026-08.md | |
