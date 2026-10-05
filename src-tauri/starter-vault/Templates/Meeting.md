<%# Example template: press ⌘N and pick Meeting to make a meeting note from it. Change it to suit, or delete it when you're done. -%>
<%* const name = await tp.system.prompt("What is the meeting about?", "") -%>
<%* await tp.file.rename("Meeting. " + name + " - " + tp.date.now("YYYY-MM-DD")) -%>
## Attendees

- 

## Notes

<% tp.file.cursor() %>

## Actions

- [ ] 
