# P2: Abstention Detection

## Problem Statement

Engram scored **10% on Abstention (ABS)** tasks in LongMemEval - the weakest category by far. The model hallucinates answers when it should say "I don't know."

Key insight from [HALT-RAG research](https://arxiv.org/html/2509.07475):
> "Equally underexplored is the distinction between abstentions, where a model refuses to answer due to insufficient context, and hallucinations."

## Expected Impact

- **ABS Accuracy**: +30-50% (from 10% to 40-60%)
- **Overall Accuracy**: +2-3%
- **Trust**: Significantly improved - wrong answers become "I don't know"

## Proposed Solution

### Three-Layer Abstention System

```
┌─────────────────────────────────────────────────────────────┐
│                    Layer 1: Retrieval                        │
│                    Confidence                                │
├─────────────────────────────────────────────────────────────┤
│  ┌─────────────┐                                            │
│  │ Top-K       │──▶ Max score < 0.3? ──▶ ABSTAIN           │
│  │ Scores      │                                            │
│  │             │──▶ Score gap < 0.1   ──▶ ABSTAIN           │
│  │             │    (uncertain match)                       │
│  └─────────────┘                                            │
├─────────────────────────────────────────────────────────────┤
│                    Layer 2: Answer                           │
│                    Grounding                                 │
├─────────────────────────────────────────────────────────────┤
│  ┌─────────────┐                                            │
│  │ Generated   │──▶ NLI: Answer entailed ──▶ PROCEED       │
│  │ Answer      │    by context?                             │
│  │             │──▶ Not entailed? ──▶ ABSTAIN              │
│  └─────────────┘                                            │
├─────────────────────────────────────────────────────────────┤
│                    Layer 3: Pattern                          │
│                    Detection                                 │
├─────────────────────────────────────────────────────────────┤
│  ┌─────────────┐                                            │
│  │ Answer      │──▶ Contains hedging? ──▶ Convert to       │
│  │ Text        │    "I think", "maybe"    explicit ABSTAIN │
│  │             │──▶ Generic filler? ──▶ ABSTAIN            │
│  └─────────────┘                                            │
└─────────────────────────────────────────────────────────────┘
```

### Implementation

#### New Module: `packages/search-core/src/abstention.ts`

```typescript
export interface AbstentionConfig {
  /** Minimum retrieval score to proceed */
  minRetrievalScore: number;
  /** Minimum score gap between top results */
  minScoreGap: number;
  /** Use NLI for answer grounding check */
  useNLI: boolean;
  /** NLI entailment threshold */
  nliThreshold: number;
  /** Patterns that indicate hedging */
  hedgingPatterns: RegExp[];
}

const DEFAULT_CONFIG: AbstentionConfig = {
  minRetrievalScore: 0.3,
  minScoreGap: 0.1,
  useNLI: true,
  nliThreshold: 0.7,
  hedgingPatterns: [
    /I('m not sure|'m uncertain|don't know)/i,
    /I think|maybe|possibly|perhaps/i,
    /cannot (find|determine|answer)/i,
    /no (information|data|evidence)/i,
    /not (mentioned|specified|stated)/i,
  ],
};

export interface AbstentionResult {
  shouldAbstain: boolean;
  reason?: "low_retrieval_score" | "no_score_gap" | "not_grounded" | "hedging_detected";
  confidence: number;
  details?: string;
}

export class AbstentionDetector {
  private config: AbstentionConfig;
  private nliModel?: NLIModel;

  constructor(config: Partial<AbstentionConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  async shouldAbstain(
    retrievalResults: SearchResult[],
    generatedAnswer: string,
    context: string
  ): Promise<AbstentionResult> {
    // Layer 1: Retrieval confidence
    const retrievalCheck = this.checkRetrievalConfidence(retrievalResults);
    if (retrievalCheck.shouldAbstain) {
      return retrievalCheck;
    }

    // Layer 2: Answer grounding (NLI)
    if (this.config.useNLI) {
      const groundingCheck = await this.checkAnswerGrounding(
        generatedAnswer,
        context
      );
      if (groundingCheck.shouldAbstain) {
        return groundingCheck;
      }
    }

    // Layer 3: Pattern detection
    const patternCheck = this.checkHedgingPatterns(generatedAnswer);
    if (patternCheck.shouldAbstain) {
      return patternCheck;
    }

    return { shouldAbstain: false, confidence: 1.0 };
  }

  private checkRetrievalConfidence(results: SearchResult[]): AbstentionResult {
    if (results.length === 0) {
      return {
        shouldAbstain: true,
        reason: "low_retrieval_score",
        confidence: 1.0,
        details: "No documents retrieved",
      };
    }

    const topScore = results[0].score;
    if (topScore < this.config.minRetrievalScore) {
      return {
        shouldAbstain: true,
        reason: "low_retrieval_score",
        confidence: 1.0 - topScore,
        details: `Top score ${topScore.toFixed(3)} below threshold ${this.config.minRetrievalScore}`,
      };
    }

    // Check score gap - if top results are too similar, we're uncertain
    if (results.length >= 2) {
      const scoreGap = topScore - results[1].score;
      if (topScore < 0.5 && scoreGap < this.config.minScoreGap) {
        return {
          shouldAbstain: true,
          reason: "no_score_gap",
          confidence: 0.7,
          details: `Score gap ${scoreGap.toFixed(3)} indicates uncertainty`,
        };
      }
    }

    return { shouldAbstain: false, confidence: topScore };
  }

  private async checkAnswerGrounding(
    answer: string,
    context: string
  ): Promise<AbstentionResult> {
    if (!this.nliModel) {
      this.nliModel = await this.loadNLIModel();
    }

    const { label, score } = await this.nliModel.predict(context, answer);

    if (label === "contradiction" || (label === "neutral" && score > 0.7)) {
      return {
        shouldAbstain: true,
        reason: "not_grounded",
        confidence: score,
        details: `Answer not entailed by context (${label}: ${score.toFixed(3)})`,
      };
    }

    return { shouldAbstain: false, confidence: score };
  }

  private checkHedgingPatterns(answer: string): AbstentionResult {
    for (const pattern of this.config.hedgingPatterns) {
      if (pattern.test(answer)) {
        return {
          shouldAbstain: true,
          reason: "hedging_detected",
          confidence: 0.8,
          details: `Hedging pattern detected: ${pattern.source}`,
        };
      }
    }

    return { shouldAbstain: false, confidence: 1.0 };
  }

  private async loadNLIModel(): Promise<NLIModel> {
    // Use cross-encoder/nli-deberta-v3-base for NLI
    const { pipeline } = await import("@xenova/transformers");
    return pipeline("text-classification", "cross-encoder/nli-deberta-v3-base");
  }
}

interface NLIModel {
  predict(premise: string, hypothesis: string): Promise<{
    label: "entailment" | "neutral" | "contradiction";
    score: number;
  }>;
}
```

#### Integration with Reader

```typescript
// packages/benchmark/src/longmemeval/reader.ts

import { AbstentionDetector } from "@engram/search-core";

export class Reader {
  private abstentionDetector?: AbstentionDetector;

  constructor(config: ReaderConfig) {
    if (config.abstentionDetection) {
      this.abstentionDetector = new AbstentionDetector(config.abstentionConfig);
    }
  }

  async read(
    question: string,
    context: string,
    retrievalResults: SearchResult[]
  ): Promise<ReadResult> {
    // Generate answer
    const answer = await this.generateAnswer(question, context);

    // Check abstention
    if (this.abstentionDetector) {
      const abstention = await this.abstentionDetector.shouldAbstain(
        retrievalResults,
        answer,
        context
      );

      if (abstention.shouldAbstain) {
        return {
          answer: "I don't have enough information to answer this question.",
          abstained: true,
          abstentionReason: abstention.reason,
          originalAnswer: answer,
        };
      }
    }

    return { answer, abstained: false };
  }
}
```

### CLI Flag

```typescript
.option("--abstention", "Enable abstention detection", false)
.option("--abstention-threshold <n>", "Retrieval score threshold", parseFloat, 0.3)
```

## Testing Strategy

1. **Unit Tests**: Each abstention layer independently
2. **Integration Tests**: Full pipeline with abstention
3. **ABS Subset**: Run on 30 ABS questions, target >50% accuracy

## Calibration Process

The abstention thresholds need calibration:

```typescript
// Sweep threshold values on validation set
const thresholds = [0.2, 0.25, 0.3, 0.35, 0.4];
for (const threshold of thresholds) {
  const accuracy = evaluate(validationSet, { minRetrievalScore: threshold });
  console.log(`Threshold ${threshold}: ${accuracy}%`);
}
// Pick threshold that maximizes accuracy on validation set
```

## Success Metrics

- ABS accuracy: 40%+ (4x improvement)
- False abstention rate: <10% (don't abstain on answerable questions)
- Overall accuracy: +2-3%

## References

- [HALT-RAG: Hallucination Detection with Abstention](https://arxiv.org/html/2509.07475)
- [Confidence-Based Response Abstinence](https://arxiv.org/html/2510.13750)
- [GopherCite: Teaching LLMs to Cite](https://arxiv.org/abs/2203.11147)
- [Synergistic RAG: Adaptive Thresholding](https://arxiv.org/html/2511.21729)
