---
type: Spec
TQ_show_tree: false
---
# Spec. Task queries

Tasks with every field the Tasks plugin reads, and blocks in its query language (src/tasksq/).

## Chores

- [ ] Take out the trash 🔁 every Sunday 📅 2026-10-04
- [ ] Water the plants 🔁 every 3 days when done ⏳ 2026-10-02
- [/] Paint the fence ⏫ 🛫 2026-09-28 📅 2026-10-10
- [-] Fix the old shed ❌ 2026-09-15
- [ ] Order the parts 🆔 parts1 🔼
- [ ] Fit the parts ⛔ parts1 🔽
- [ ] One-off reminder 🏁 delete 📅 2026-10-05

## Queries

```tasks
not done
path includes {{query.file.path}}
group by status.type
sort by priority
explain
```

```tasks
(is recurring) OR (priority is above none)
short mode
hide backlink
```
