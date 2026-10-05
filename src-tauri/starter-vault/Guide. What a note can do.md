---
tags: [example]
---

> [!example] Example note
> This note shows what you can write in a note. Switch between View, Edit and Source at the top to see the markdown behind each part. Delete it when you're done.

## Links and tags

Link a note with double square brackets: [[Project. Orbit App launch]]. Link a heading with `#`: [[Orbit App#Current state]]. A link to a note that doesn't exist yet, such as [[Launch retrospective]], is a quick way to make it. Tags like #example group notes.

## Callouts

> [!tip] A tip
> A callout is a quote whose first line says its kind, such as note, tip, warning or question.

> [!warning]- A folded warning
> A `-` after the kind folds it. Click the title to open it.

## Maths

Inline maths sits between single dollar signs: $x^2 + y^2 = z^2$. Prices such as $5 and $10 stay as they are. A block goes between double dollar signs:

$$
\sum_{i=1}^{n} i = \frac{n(n+1)}{2}
$$

## A table

| Phase | Who | When |
|---|---|---|
| Pilot | Maya | Done |
| Soft launch | Lena | In {{date+30}} |

## A live task query

This block lists every open task due in the next two weeks, from any note. It updates as the tasks change.

```tasks
not done
due before in two weeks
sort by due
```

## A task with every kind of date

- [ ] Review the launch checklist #context/computer [effort:: 30m] 🛫 {{date}} ⏳ {{date+1}} 📅 {{date+3}}

📅 is due, ⏳ deferred until and 🛫 start. In the app they show as icons and chips.
