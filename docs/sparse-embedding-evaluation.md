# Sparse Embedding Model Evaluation

## Current Implementation

The current `BM25Sparse` class in `packages/search-core/src/services/text-embedder.ts` uses:
- Simple TF-based scoring without IDF
- FNV-1a hash-based token indexing (30k vocabulary)
- BM25-like term frequency saturation (k1=1.2, b=0.75)

Limitations:
- No IDF weighting (treats all terms equally important)
- Hash collisions reduce precision
- No vocabulary-aware tokenization

## SPLADE Models Evaluation

### Models Available on Hugging Face
- `naver/splade-v3` - Latest version, trained with KL-Div and MarginMSE
- `naver/splade-cocondenser-ensembledistil` - Popular v2 variant
- `naver/splade-v3-distilbert` - Lighter distilled version

### Key Advantages of SPLADE
1. **Learned sparse representations** - Uses BERT MLM head to generate token importance weights
2. **Query/document expansion** - Adds semantically related terms not in original text
3. **Handles vocabulary mismatch** - Better synonym and typo handling
4. **Outperforms BM25** - Consistently better on benchmarks

### JavaScript/Transformers.js Support
**Status: Not directly supported**

- SPLADE models use MLM head + SpladePooling (max + ReLU)
- No ONNX weights published for SPLADE models
- Would require manual conversion and custom post-processing

### Implementation Path (if pursuing)
1. Convert `naver/splade-v3-distilbert` to ONNX using Optimum
2. Use transformers.js fill-mask pipeline to get MLM logits
3. Apply max pooling + ReLU to generate sparse vectors
4. Map token IDs to vocabulary indices

Estimated effort: 3-5 days including testing

## Alternative: BGE-M3

BGE-M3 (BAAI/bge-m3) supports hybrid retrieval with:
- Dense embeddings (1024d)
- Sparse embeddings (vocabulary-based)
- ColBERT-style multi-vector

**Status:** Also requires ONNX conversion, similar complexity to SPLADE.

## Recommendations

### Short-term (Recommended)
Improve current BM25 implementation:
1. Add IDF estimation based on document frequency stats
2. Use proper tokenizer (from transformers.js) instead of hash
3. Store corpus statistics in Qdrant collection metadata

### Medium-term
If sparse retrieval quality is insufficient:
1. Convert SPLADE-distilbert to ONNX
2. Implement SpladePooling in JavaScript
3. Benchmark against improved BM25

### Long-term
Monitor transformers.js for:
- Official SPLADE ONNX model releases
- Native sparse encoder support
- FastEmbed JS library availability

## Sources
- [SPLADE GitHub](https://github.com/naver/splade)
- [naver/splade-v3](https://huggingface.co/naver/splade-v3)
- [Sentence Transformers Sparse Encoder](https://sbert.net/examples/sparse_encoder/applications/computing_embeddings/README.html)
- [Pinecone SPLADE Guide](https://www.pinecone.io/learn/splade/)
- [Transformers.js Documentation](https://huggingface.co/docs/transformers.js)
