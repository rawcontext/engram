# Bead: Implement Graph Node Writer

## Context
Writing to the graph requires managing the "Transaction Time".

## Goal
Implement `GraphWriter.writeNode(node)` which handles the "Insert" logic.

## Logic
```typescript
async writeNode(nodeData: NodeData) {
  const now = Date.now();
  const query = `
    CREATE (n:${nodeData.label} {
      id: $id,
      vt_start: $vt, vt_end: ${MAX_DATE},
      tt_start: ${now}, tt_end: ${MAX_DATE},
      ...$props
    })
  `;
  await client.query(query, { ... });
}
```

## Acceptance Criteria
-   [ ] Writer implemented.
-   [ ] Correctly sets default MAX_DATE for end times.
