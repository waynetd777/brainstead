---
tags: [spec, dataview]
rating: 8
status: active
related: "[[Orbit App]]"
---
# Dataview examples

Inline fields on their own lines, in brackets and in brackets that hide the key:

Owner:: Maya
**Review date**:: 2026-10-09
Effort:: 3 days
A sentence with [mood:: focused] and (energy:: high) inside it.

- Reading list [book:: Dune] [pages:: 412]
- Plain item with [book:: Emma]

Inline query: this note's owner is `= this.owner`, rated `= this.rating * 10`%.

```dataview
TABLE rating, status, file.mtime AS "Changed"
FROM #spec
SORT file.name
```

```dataview
LIST rows.file.link
FROM #spec OR #project
GROUP BY status
```

```dataview
TABLE WITHOUT ID item.book AS "Book", item.pages AS "Pages"
FROM "Spec. Dataview"
FLATTEN file.lists AS item
WHERE item.book
```

```dataviewjs
const pages = dv.pages("#spec").sort(p => p.file.name);
dv.paragraph(`${pages.length} spec notes`);
dv.table(["Note", "Tags"], pages.map(p => [p.file.link, p.file.etags]));
```
