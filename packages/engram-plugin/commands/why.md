---
description: Find past decisions and their reasoning
allowed-tools: engram_recall
---

# Why (Decision History)

Find the reasoning behind past architectural and design decisions.

## Instructions

1. Call `engram_recall` with:
   - `query`: "decisions about {topic}" where topic is from the user's question
   - `filters`: `{ "type": "decision" }`
   - `limit`: 5
   - `rerank`: true

2. If results are sparse, try a broader search:
   - Remove "decisions about" prefix
   - Search with just the topic keywords

3. Present findings as a narrative:
   - What was decided
   - Why it was chosen (the rationale)
   - When it was recorded (if available)
   - Any related decisions

4. If no decisions found:
   - Say so clearly
   - Offer to search more broadly
   - Offer to help make and record a decision now

## Example Usage

```
/engram:why did we choose FalkorDB?
/engram:why bitemporal modeling?
/engram:why use NATS instead of Kafka?
/engram:why are skills model-invoked?
```

The "why" can be implicit - parse the topic from natural questions:
- "Why FalkorDB?" → search "decisions about FalkorDB"
- "Why do we use tabs?" → search "decisions about tabs formatting"
