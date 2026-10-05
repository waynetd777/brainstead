<%# Example template: a project. It asks for the name, the outcome and the first next action, writes the properties Projects reads (status, area, outcome), names the note Project. <name> with tp.file.rename so it shows on Projects, and starts it with the Next actions and Waiting for headings. Delete it when you're done. -%>
<%* const answer = await tp.system.prompt("Project name", "", true) -%>
<%* const name = answer.replace(/[\\/:*?"<>|#^[\]]/g, "").trim() -%>
<%* if (!name) throw new Error("A project needs a name.") -%>
<%* const outcome = (await tp.system.prompt("What does done look like?")) ?? "" -%>
<%* const area = (await tp.system.prompt("Area", "Work")) ?? "" -%>
<%* const next = (await tp.system.prompt("The very next action")) ?? "" -%>
<%* const yaml = (s) => (/^[\w][\w ,.()-]*$/.test(s.trim()) ? s.trim() : JSON.stringify(s.trim())) -%>
<%* await tp.file.rename("Project. " + name) -%>
---
status: active
area: <% yaml(area) %>
outcome: <% yaml(outcome) %>
---

## Next actions

<%* if (next.trim()) tR += `- [ ] ${next.trim()}\n\n` -%>
## Waiting for

## Notes

<% tp.file.cursor() %>
