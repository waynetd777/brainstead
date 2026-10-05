> **This is a system note** — Master task list. Tasks from any note flow into **To Do**, **Follow-ups** (`#followup`), **Waiting for** (`#waiting-for`), or **Someday/Maybe** (`#someday-maybe`) via Dataview / Tasks queries; capture adhoc tasks under **Other**. Closed tasks (`✅ YYYY-MM-DD`) surface in **Done This Week** / **Done Last Week**. In the LLM Wiki UI: drag a row to reorder (writes `^rank-N` to each line), click a task description to jump to its source, right-click a task or type `due:` / `defer:` for a date picker (writes `📅 YYYY-MM-DD` / `⏳ YYYY-MM-DD`).

#### To Do

```dataview
TASK
WHERE !completed AND !contains(tags, "#followup") AND !contains(tags, "#waiting-for") AND !contains(tags, "#someday-maybe")
SORT rank
```

#### Follow-ups

```tasks
not done
(tags include #followup)
```

#### Waiting for

```dataview
TASK
WHERE !completed AND contains(tags, "#waiting-for")
SORT rank
```

#### Someday/Maybe

```dataview
TASK
WHERE !completed AND contains(tags, "#someday-maybe")
SORT rank
```

#### Other

* [ ] Walk through the Dashboard — every card has a help drawer (?) in the top-right
* [ ] Read `CLAUDE.md` at the vault root and adapt it to how your vault is organised
* [ ] Try `⌘⌥C` to open Chat — type `/` to see the bundled skills
* [ ] Try `⌘⌥N` to scaffold a new note from a Template
* [ ] Try typing `due:` here in edit mode — it pops a date picker that writes 📅 YYYY-MM-DD
* [ ] Example follow-up — this row also appears in **Follow-ups** above #followup
* [ ] Example waiting item — this row also appears in **Waiting for** above #waiting-for
* [ ] Example someday item — this row also appears in **Someday/Maybe** above #someday-maybe

#### Done This Week

```tasks
done this week
sort by done reverse
```

#### Done Last Week

```tasks
done last week
sort by done reverse
```
