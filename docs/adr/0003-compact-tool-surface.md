# ADR-0003 — Group tools by noun; do not ship one tool per verb

**Status:** accepted · 2026-09-08

## Context

Existing Aseprite MCP servers expose between 44 and roughly 122 tools — one per
operation: `live_new_layer`, `live_rename_layer`, `live_delete_layer`,
`live_set_layer_visibility`, and so on.

Every one of those schemas is resident in the model's context on **every turn of
every conversation**, whether or not the user is drawing anything. A hundred
tool definitions with real descriptions is a five-figure token bill per turn,
paid by users who asked about something else entirely. At least one existing
implementation has had to spend releases trimming its own descriptions to claw
some of it back.

## Decision

One tool per **noun**, an `op` enum for the verbs, and a batch array wherever an
agent would otherwise loop. Eighteen tools total.

```
layer  op=create|rename|delete|reorder|set|group|merge|…   batch=[…]
frame  op=list|add|duplicate|delete|set_duration|…
draw   ops=[{kind:"rect",…},{kind:"line",…},…]
look   op=preview|ascii|filmstrip|diff
```

A test asserts the count stays at or under 24, so the next person to reach for
"just one more tool" has to argue with CI first.

## Consequences

**Good.** The whole surface costs roughly what fifteen single-purpose tools
would, while covering what ninety do.

**Good.** Batching became the default rather than an optimisation. `draw` takes
an array of operations applied in one Aseprite transaction, which means the
user's Ctrl+Z undoes "the agent's edit" instead of one stray pixel out of forty.

**Bad.** An `op` enum is a weaker contract than a dedicated tool: the model has
to know which arguments belong to which op, and a wrong combination is caught at
runtime rather than by the schema. Mitigated by writing the per-op argument
rules into each description, and by validating loudly.

**Bad.** Something a user wants will eventually fall outside eighteen tools.
That is what `run_lua` is for — off by default, since it is arbitrary code
execution in the application holding the user's unsaved work.
