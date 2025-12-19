# Engram Retrieval v2: Roadmap to SOTA

## Current State
- **LongMemEval Accuracy**: 75.8%
- **SOTA (Emergence AI)**: 86%
- **Gap**: 10.2 percentage points

## Target
Close the gap to SOTA with 6 prioritized improvements.

## Improvement Summary

| Priority | Feature | Expected Gain | Effort | Status |
|:--------:|:--------|:-------------:|:------:|:------:|
| 1 | [Multi-Query Retrieval](./01-multi-query-retrieval.md) | +5-8% | Medium | Planned |
| 2 | [Abstention Detection](./02-abstention-detection.md) | +3-5% (ABS) | Low | Planned |
| 3 | [Session-Aware Retrieval](./03-session-aware-retrieval.md) | +2-4% (MR) | Medium | Planned |
| 4 | [Temporal Query Understanding](./04-temporal-query.md) | +3-5% (TR) | Low | Planned |
| 5 | [Embedding Model Upgrade](./05-embedding-upgrade.md) | +2-3% | Low | Planned |
| 6 | [Learned Fusion](./06-learned-fusion.md) | +1-2% | High | Planned |

**Total Expected Gain**: 16-27% (theoretical maximum)
**Realistic Target**: 85-88% accuracy

## Implementation Order

```
Phase 1 (Quick Wins):
├── P2: Abstention Detection (low effort, fixes weakest area)
├── P4: Temporal Query Understanding (low effort)
└── P5: Embedding Model Upgrade (config change)

Phase 2 (Core Improvements):
├── P1: Multi-Query Retrieval (biggest impact)
└── P3: Session-Aware Retrieval (MR improvement)

Phase 3 (Optimization):
└── P6: Learned Fusion (requires training data)
```

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────┐
│                     Query Processing                         │
├─────────────────────────────────────────────────────────────┤
│  ┌─────────────┐   ┌─────────────┐   ┌─────────────┐       │
│  │  Temporal   │──▶│ Multi-Query │──▶│   Session   │       │
│  │   Parser    │   │  Expansion  │   │   Router    │       │
│  └─────────────┘   └─────────────┘   └─────────────┘       │
├─────────────────────────────────────────────────────────────┤
│                      Retrieval                               │
├─────────────────────────────────────────────────────────────┤
│  ┌─────────────┐   ┌─────────────┐   ┌─────────────┐       │
│  │   Dense     │   │   Sparse    │   │  Session    │       │
│  │  (NV-Embed) │   │  (SPLADE)   │   │   Index     │       │
│  └──────┬──────┘   └──────┬──────┘   └──────┬──────┘       │
│         │                 │                 │               │
│         └────────┬────────┴────────┬────────┘               │
│                  ▼                 ▼                        │
│           ┌─────────────┐   ┌─────────────┐                │
│           │ Learned RRF │──▶│  Reranker   │                │
│           │   Fusion    │   │ (Accurate)  │                │
│           └─────────────┘   └─────────────┘                │
├─────────────────────────────────────────────────────────────┤
│                    Post-Processing                          │
├─────────────────────────────────────────────────────────────┤
│  ┌─────────────┐   ┌─────────────┐                         │
│  │ Confidence  │──▶│  Abstention │                         │
│  │  Scoring    │   │  Decision   │                         │
│  └─────────────┘   └─────────────┘                         │
└─────────────────────────────────────────────────────────────┘
```

## References

- [DMQR-RAG: Diverse Multi-Query Rewriting](https://arxiv.org/html/2411.13154v1)
- [HALT-RAG: Hallucination Detection with Abstention](https://arxiv.org/html/2509.07475)
- [LiCoMemory: Hierarchical Session Memory](https://arxiv.org/html/2511.01448)
- [TG-RAG: Temporal Graph RAG](https://arxiv.org/html/2510.13590v1)
- [NV-Embed-v2: NVIDIA Embedding Model](https://developer.nvidia.com/blog/nvidia-text-embedding-model-tops-mteb-leaderboard/)
- [Emergence AI: SOTA on LongMemEval](https://www.emergence.ai/blog/sota-on-longmemeval-with-rag)
