# Security

Treat every UI document as untrusted output from a model. The protocol is designed so that a malicious or confused Agent can at most show a badly designed card to the user it was already talking to.

## What a document cannot do

- **Run code.** There is no component for HTML, Markdown, scripts, styles or embedded applications. The runtime builds DOM nodes with `textContent` and attributes; it never parses Agent strings as HTML. Validators are precompiled, so the runtime needs no `eval` or `unsafe-eval`.
- **Reach arbitrary URLs.** Image, link and preview URLs must be absolute and match the contract's schemes and origins. `javascript:`, `file:`, credentials in URLs and SVG data images are rejected. The runtime checks the policy again before rendering and falls back to text.
- **Grant permissions.** Preview sandbox tokens, link targets and referrer behavior come from host policy only. A preview frame never gets `allow-same-origin` for the embedding page's own origin, and policies that combine `allow-scripts` with `allow-same-origin` must list `hostOrigins` so those origins are rejected at validation.
- **Choose its audience.** Surfaces, principals and authorization come from the host's `authenticate` and `authorize`. Agent-supplied surface or document ids never grant access to another user's surface.
- **Exhaust resources.** Documents are bounded in bytes, components, nesting depth, string length, datasets and rows, and validation work and diagnostics are capped. Raw nesting is checked iteratively before any cloning or recursion.
- **Pollute prototypes.** `__proto__`, `constructor` and `prototype` are rejected as bind keys, dataset names and row fields.

## Events and state are untrusted too

Values a browser validated can be forged. The host re-validates every event against the committed revision it names: the revision must be current, the source must run that action, and the values must be exactly the visible fields of that form, with valid types, options and constraints. Events are deduplicated by `eventId`. Saved state is checked against the document's bindings. Business authorization is rechecked when an action executes, regardless of earlier validity.

## Web previews

A cross-origin preview does not expose its content or user actions to the Agent. Sites may refuse embedding (`X-Frame-Options`, `frame-ancestors`) or need a login the frame cannot provide, and a parent page cannot reliably detect every failure. The runtime therefore always shows an "Open original" link (when the link policy allows it) and a hint. If your backend fetches URLs for previews or images, apply server-side request policy (allow lists, no private addresses, size and time limits); client-side URL checks are not enough.

Cooperative messaging with previewed pages is not part of 1.0.

## Transport

- The service sends `X-Content-Type-Options: nosniff` and `Cache-Control: no-store`, and rejects cross-origin requests from origins outside `cors.origins`, including on `/mcp` (DNS rebinding protection).
- Delivery streams use `fetch` with headers instead of `EventSource`, so tokens stay out of URLs.
- Run behind TLS. Bind local services to 127.0.0.1, as the CLI does by default.

## Extensions

Extension components are trusted host code. Register them only from your own bundle; never load renderers or schemas named by a document. Extension schemas are compiled with Ajv, which uses code generation, so compile them on the server (`compileExtensions`) rather than in CSP-restricted pages.

## Legacy document format

The 0.2 `InteractiveDocument` format (`@haowei2000/intelligence-ui`, `/browser`, `/react`, `/document`) accepts sanitized HTML and CSS and renders through a separate path. Do not feed model output into it unless you accept that it is a richer surface; new integrations should use the component protocol.

## Reporting

Report vulnerabilities privately to the maintainers rather than in public issues.
