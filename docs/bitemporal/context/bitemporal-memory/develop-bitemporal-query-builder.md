# Bead: Develop Bitemporal Query Builder

## Context
Writing raw Cypher for bitemporal queries is error-prone. We need a builder.

## Goal
Create a fluent API to construct queries that automatically inject time bounds.

## Interface
```typescript
// Query: Find thoughts valid at T_valid and known at T_transaction
const query = new QueryBuilder()
  .match('(s:Session)-[:TRIGGERS]->(t:Thought)')
  .where('s.id = $sessionId')
  .at({ vt: queryDate, tt: 'current' }) // Injects standard temporal WHERE clauses
  .return('t');
```

## Logic
The `.at()` method appends:
```cypher
AND (n.vt_start <= $vt AND n.vt_end > $vt)
AND (n.tt_start <= $tt AND n.tt_end > $tt)
```
...for every node/edge alias in the MATCH clause (this requires parsing the MATCH clause or explicit alias registration). *Simplification*: User passes aliases to `.at(['s', 't'], { ... })`.

## Acceptance Criteria
-   [ ] `QueryBuilder` class implemented.
-   [ ] Tests verify correct Cypher string generation.
