# Bead: Create GraphQL Schema Definition

## Context
A complex Bitemporal Graph is best queried via GraphQL.

## Goal
Define the Schema for `Session`, `Thought`, `Fact`, and `Timeline`.

## Schema
```graphql
type Session {
  id: ID!
  startTime: Float!
  thoughts(limit: Int): [Thought!]!
}

type Thought {
  id: ID!
  role: String!
  content: String
  validFrom: Float!
  validTo: Float
  transactionStart: Float!
  transactionEnd: Float
  causedBy: [ToolCall!]
}

type ToolCall {
  id: ID!
  name: String!
  args: String
  output: String
}

type Query {
  session(id: ID!): Session
  search(query: String!): [Thought!]
  graph(cypher: String!): JSON
}
```

## Strategy
-   **Implementation**: `graphql-yoga` inside a Next.js API route (`/api/graphql`).
-   **Resolvers**: Call the MCP Clients (Memory, Search).

## Acceptance Criteria
-   [ ] `schema.graphql` file created.
-   [ ] `codegen` configured to generate TypeScript types.
