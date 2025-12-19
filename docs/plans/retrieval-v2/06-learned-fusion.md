# P6: Learned Fusion

## Problem Statement

Engram uses fixed RRF (Reciprocal Rank Fusion) with k=60 to combine dense and sparse retrieval results. This one-size-fits-all approach isn't optimal:

- Some queries benefit more from dense (semantic)
- Some queries benefit more from sparse (keyword)
- Optimal fusion weights vary by query type

Research shows learned fusion consistently outperforms fixed fusion ([Synergistic RAG](https://arxiv.org/html/2511.21729)).

## Expected Impact

- **Overall Accuracy**: +1-2%
- **Retrieval Recall**: +3-5%
- **Query-Adaptive**: Better handling of different query types

## Proposed Solution

### Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    Query Analysis                            │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│   Query ──▶ Feature Extractor ──▶ Query Features            │
│              - Query length                                  │
│              - Entity density                                │
│              - Temporal markers                              │
│              - Question type                                 │
│                                                              │
├─────────────────────────────────────────────────────────────┤
│                    Weight Prediction                         │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│   Query Features ──▶ MLP ──▶ [w_dense, w_sparse, w_rerank]  │
│                      (trained)                               │
│                                                              │
├─────────────────────────────────────────────────────────────┤
│                    Weighted Fusion                           │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│   final_score = w_dense * dense_score                       │
│               + w_sparse * sparse_score                      │
│               + w_rerank * rerank_score                      │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

### Implementation

#### Feature Extraction

```typescript
// packages/search-core/src/fusion/features.ts

export interface QueryFeatures {
  /** Number of tokens */
  length: number;
  /** Ratio of named entities to total tokens */
  entityDensity: number;
  /** Whether query contains temporal markers */
  hasTemporal: boolean;
  /** Question type: factoid, list, comparison, etc. */
  questionType: QuestionType;
  /** Average IDF of query terms */
  avgIDF: number;
  /** Whether query contains rare terms */
  hasRareTerms: boolean;
}

export type QuestionType =
  | "factoid"    // Who, what, when, where
  | "list"       // List all, enumerate
  | "comparison" // Compare, difference
  | "causal"     // Why, how
  | "opinion"    // What do you think
  | "other";

export class QueryFeatureExtractor {
  private nerModel: NERModel;
  private idfIndex: Map<string, number>;

  async extract(query: string): Promise<QueryFeatures> {
    const tokens = this.tokenize(query);
    const entities = await this.nerModel.extract(query);

    return {
      length: tokens.length,
      entityDensity: entities.length / tokens.length,
      hasTemporal: this.detectTemporal(query),
      questionType: this.classifyQuestion(query),
      avgIDF: this.calculateAvgIDF(tokens),
      hasRareTerms: tokens.some(t => this.idfIndex.get(t) ?? 0 > 5),
    };
  }

  private classifyQuestion(query: string): QuestionType {
    const lower = query.toLowerCase();
    if (/^(who|what|when|where)\b/.test(lower)) return "factoid";
    if (/^(list|enumerate|name all)\b/.test(lower)) return "list";
    if (/\b(compare|difference|versus|vs)\b/.test(lower)) return "comparison";
    if (/^(why|how)\b/.test(lower)) return "causal";
    if (/\b(think|opinion|feel)\b/.test(lower)) return "opinion";
    return "other";
  }

  private detectTemporal(query: string): boolean {
    return /\b(yesterday|today|last|recent|before|after|when)\b/i.test(query);
  }
}
```

#### Weight Predictor

```typescript
// packages/search-core/src/fusion/predictor.ts

import * as ort from "onnxruntime-node";

export interface FusionWeights {
  dense: number;
  sparse: number;
  rerank: number;
}

export class FusionWeightPredictor {
  private session: ort.InferenceSession | null = null;
  private modelPath: string;

  constructor(modelPath: string = "models/fusion_mlp.onnx") {
    this.modelPath = modelPath;
  }

  async predict(features: QueryFeatures): Promise<FusionWeights> {
    const session = await this.getSession();

    // Convert features to tensor
    const input = new ort.Tensor("float32", [
      features.length / 20,  // Normalize
      features.entityDensity,
      features.hasTemporal ? 1 : 0,
      this.encodeQuestionType(features.questionType),
      features.avgIDF / 10,  // Normalize
      features.hasRareTerms ? 1 : 0,
    ], [1, 6]);

    // Run inference
    const results = await session.run({ input });
    const output = results.output.data as Float32Array;

    // Softmax to ensure weights sum to 1
    const weights = this.softmax(Array.from(output));

    return {
      dense: weights[0],
      sparse: weights[1],
      rerank: weights[2],
    };
  }

  private encodeQuestionType(type: QuestionType): number {
    const encoding: Record<QuestionType, number> = {
      factoid: 0.0,
      list: 0.2,
      comparison: 0.4,
      causal: 0.6,
      opinion: 0.8,
      other: 1.0,
    };
    return encoding[type];
  }

  private softmax(arr: number[]): number[] {
    const max = Math.max(...arr);
    const exp = arr.map(x => Math.exp(x - max));
    const sum = exp.reduce((a, b) => a + b);
    return exp.map(x => x / sum);
  }

  private async getSession(): Promise<ort.InferenceSession> {
    if (!this.session) {
      this.session = await ort.InferenceSession.create(this.modelPath);
    }
    return this.session;
  }
}
```

#### Learned Fusion

```typescript
// packages/search-core/src/fusion/learned.ts

export class LearnedFusion {
  private featureExtractor: QueryFeatureExtractor;
  private weightPredictor: FusionWeightPredictor;

  constructor() {
    this.featureExtractor = new QueryFeatureExtractor();
    this.weightPredictor = new FusionWeightPredictor();
  }

  async fuse(
    query: string,
    denseResults: SearchResult[],
    sparseResults: SearchResult[],
    rerankResults?: SearchResult[]
  ): Promise<SearchResult[]> {
    // Extract features and predict weights
    const features = await this.featureExtractor.extract(query);
    const weights = await this.weightPredictor.predict(features);

    // Build score map
    const scoreMap = new Map<string, FusedScore>();

    for (const result of denseResults) {
      const existing = scoreMap.get(result.id) ?? { result, scores: {} };
      existing.scores.dense = result.score;
      scoreMap.set(result.id, existing);
    }

    for (const result of sparseResults) {
      const existing = scoreMap.get(result.id) ?? { result, scores: {} };
      existing.scores.sparse = result.score;
      scoreMap.set(result.id, existing);
    }

    if (rerankResults) {
      for (const result of rerankResults) {
        const existing = scoreMap.get(result.id);
        if (existing) {
          existing.scores.rerank = result.score;
        }
      }
    }

    // Calculate weighted scores
    const fused = Array.from(scoreMap.values()).map(({ result, scores }) => {
      const finalScore =
        (scores.dense ?? 0) * weights.dense +
        (scores.sparse ?? 0) * weights.sparse +
        (scores.rerank ?? 0) * weights.rerank;

      return { ...result, score: finalScore };
    });

    return fused.sort((a, b) => b.score - a.score);
  }
}

interface FusedScore {
  result: SearchResult;
  scores: {
    dense?: number;
    sparse?: number;
    rerank?: number;
  };
}
```

### Training Pipeline

```python
# scripts/train_fusion_mlp.py

import torch
import torch.nn as nn
from torch.utils.data import DataLoader, Dataset

class FusionMLP(nn.Module):
    def __init__(self, input_dim=6, hidden_dim=32, output_dim=3):
        super().__init__()
        self.layers = nn.Sequential(
            nn.Linear(input_dim, hidden_dim),
            nn.ReLU(),
            nn.Dropout(0.1),
            nn.Linear(hidden_dim, hidden_dim),
            nn.ReLU(),
            nn.Dropout(0.1),
            nn.Linear(hidden_dim, output_dim),
        )

    def forward(self, x):
        return self.layers(x)

class FusionDataset(Dataset):
    def __init__(self, data_path: str):
        # Load training data: (features, optimal_weights)
        # Optimal weights derived from grid search on validation set
        self.data = self.load_data(data_path)

    def load_data(self, path):
        # Each sample: query features + optimal fusion weights
        # Optimal = weights that maximize recall for this query
        pass

def train_fusion_model(data_path: str, output_path: str):
    dataset = FusionDataset(data_path)
    loader = DataLoader(dataset, batch_size=32, shuffle=True)

    model = FusionMLP()
    optimizer = torch.optim.Adam(model.parameters(), lr=1e-3)
    criterion = nn.MSELoss()

    for epoch in range(100):
        for features, targets in loader:
            optimizer.zero_grad()
            outputs = model(features)
            loss = criterion(outputs, targets)
            loss.backward()
            optimizer.step()

    # Export to ONNX
    dummy_input = torch.randn(1, 6)
    torch.onnx.export(model, dummy_input, output_path)

if __name__ == "__main__":
    train_fusion_model("data/fusion_training.jsonl", "models/fusion_mlp.onnx")
```

### Training Data Generation

```typescript
// scripts/generate_fusion_training_data.ts

async function generateTrainingData(
  dataset: LongMemEvalInstance[],
  outputPath: string
) {
  const trainingData: TrainingSample[] = [];

  for (const instance of dataset) {
    const features = await extractor.extract(instance.question);

    // Grid search for optimal weights
    const bestWeights = await findOptimalWeights(instance);

    trainingData.push({
      features: featuresToArray(features),
      optimalWeights: [bestWeights.dense, bestWeights.sparse, bestWeights.rerank],
    });
  }

  await writeFile(outputPath, JSON.stringify(trainingData));
}

async function findOptimalWeights(instance: Instance): Promise<FusionWeights> {
  let bestRecall = 0;
  let bestWeights: FusionWeights = { dense: 0.5, sparse: 0.3, rerank: 0.2 };

  // Grid search
  for (const dense of [0.2, 0.4, 0.6, 0.8]) {
    for (const sparse of [0.1, 0.2, 0.3, 0.4]) {
      const rerank = 1 - dense - sparse;
      if (rerank < 0) continue;

      const results = await retrieveWithWeights(instance.question, { dense, sparse, rerank });
      const recall = calculateRecall(results, instance.evidence);

      if (recall > bestRecall) {
        bestRecall = recall;
        bestWeights = { dense, sparse, rerank };
      }
    }
  }

  return bestWeights;
}
```

### CLI Flag

```typescript
.option("--learned-fusion", "Use learned fusion weights instead of fixed RRF", false)
.option("--fusion-model <path>", "Path to fusion MLP model", "models/fusion_mlp.onnx")
```

## Fallback: Adaptive RRF

If learned fusion is too complex, implement adaptive RRF as simpler alternative:

```typescript
export function adaptiveRRF(
  query: string,
  denseResults: SearchResult[],
  sparseResults: SearchResult[]
): SearchResult[] {
  // Adjust k based on query characteristics
  const hasEntities = /[A-Z][a-z]+/.test(query);
  const isKeywordHeavy = query.split(" ").length <= 4;

  // Higher k = more weight to lower-ranked results
  // Keyword queries benefit from sparse, use lower k for sparse
  const k_dense = 60;
  const k_sparse = hasEntities || isKeywordHeavy ? 30 : 60;

  // ... RRF with different k values
}
```

## Success Metrics

- Overall accuracy: +1-2%
- Query-type accuracy variance: Reduced
- Retrieval recall: +3-5%

## References

- [Synergistic RAG: Adaptive Calibration](https://arxiv.org/html/2511.21729)
- [Learning to Rank with Neural Networks](https://arxiv.org/abs/2003.06454)
- [Hybrid Search Optimization](https://www.pinecone.io/learn/hybrid-search-intro/)
- [RRF Analysis](https://plg.uwaterloo.ca/~gvcormac/cormacksigir09-rrf.pdf)
