<%# Example template: a daily note. It shows tp.date.now with day offsets (the links to yesterday's and tomorrow's notes), tp.file.rename, and tp.file.include, which pulls in Templates/Snippets/End of day. Change it to suit, or delete it and the snippet when you're done. -%>
<%* const day = (offset) => "Daily. " + tp.date.now("dddd - YYYY-MM-DD", offset) -%>
<%* await tp.file.rename(day(0)) -%>
# <% tp.date.now("dddd D MMMM YYYY") %>

← [[<% day(-1) %>]] · [[<% day(1) %>]] →

## Focus

- <% tp.file.cursor() %>

## Notes

<% tp.file.include("[[Templates/Snippets/End of day]]") %>
