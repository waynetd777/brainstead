<%# Example template: a plan for the week. It shows a script block that loops over the working days and writes a heading for each with tR +=, a suggester for this week or next, and tp.user.quarter, a user script in Templates/scripts/quarter.js. Delete it, and the script, when you're done. -%>
<%* const offset = (await tp.system.suggester(["This week", "Next week"], [0, 7], false, "Which week?")) ?? 0 -%>
<%* const monday = moment(tp.date.weekday("YYYY-MM-DD", offset), "YYYY-MM-DD") -%>
<%* await tp.file.rename(`Plan. Week ${monday.format("W")} - ${monday.format("YYYY-MM-DD")}`) -%>
# Week <% monday.format("W") %>: <% monday.format("D MMM") %> to <% monday.clone().add(4, "days").format("D MMM") %>

<% tp.user.quarter(monday.format("YYYY-MM-DD")) %>

## Outcomes for the week

1. <% tp.file.cursor() %>

<%*
for (let i = 0; i < 5; i++) {
  tR += `## ${monday.clone().add(i, "days").format("dddd D MMMM")}\n\n- \n\n`;
}
-%>
## Notes
