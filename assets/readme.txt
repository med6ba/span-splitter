SPAN SPLITTER — OFFLINE EDITOR

Launch:
  Extract the ZIP, then open index.html directly in a browser.
  No server, npm packages, or internet connection required.

Interface:
  - Input (left): Import, Copy Input, Clear.
  - Output (right): Code/Preview, Copy Output, Download, Settings.
  - Drag the divider between panels to resize them; double-click to reset.
  - On narrow screens the editors are stacked and the divider is horizontal.

Settings (centered dialog):
  - Word wrap: enable or disable horizontal scrolling in code editors.
  - Auto-protect [tags]: ON by default. Preserves bracket-style tokens
    like [first_name], [url], [an_5_15] in text nodes.
  - Dark mode: toggles light/dark appearance.

Preview:
  - Conversion is immediate while typing; preview is kept up to date.
  - Preview executes no JavaScript because it is sandboxed.
  - Common markup problems (unclosed tags, mismatched closing tags,
    unclosed comments/quotes) display "Check your HTML" with the line.
    Correct the input to remove the warning and restore the preview.
  - The checker is lightweight, not a complete HTML5/CSS validator.

Output:
  Only normal text is converted into one <span> per visible grapheme.
  HTML tags, attributes, comments, scripts/styles, whitespace, and
  formatting-only text are preserved as supplied.
  HTML spans can affect letter spacing, typography and rendering in
  particular email clients; verify the result in your target client.
