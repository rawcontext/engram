import { SearchIndexer, SearchRetriever, SchemaManager } from "@the-soul/search-core";
import { createKafkaClient } from "@the-soul/storage";

const schemaManager = new SchemaManager();
const indexer = new SearchIndexer();
const retriever = new SearchRetriever();
const kafka = createKafkaClient("search-service");

// Initialize
await schemaManager.ensureCollection();

// Kafka Consumer for Indexing
// In a real app, we'd run this in a separate worker or async loop.
const startConsumer = async () => {
  const consumer = await kafka.createConsumer("search-group");
  await consumer.subscribe({ topic: "memory.node_created", fromBeginning: false });

  await consumer.run({
    eachMessage: async ({ topic, partition, message }) => {
      try {
        const value = message.value?.toString();
        if (!value) return;
        const node = JSON.parse(value);
        // Check if Indexable
        if (
          node.labels &&
          (node.labels.includes("Thought") || node.labels.includes("CodeArtifact"))
        ) {
          await indexer.indexNode(node);
          console.log(`Indexed node ${node.id}`);
        }
      } catch (e) {
        console.error("Indexing error", e);
      }
    },
  });
};

// Start Consumer (Non-blocking)
startConsumer().catch(console.error);

// HTTP Server for Retrieval
const server = Bun.serve({
  port: 8080,
  async fetch(req) {
    const url = new URL(req.url);
    if (url.pathname === "/health") return new Response("OK");

    if (url.pathname === "/search" && req.method === "POST") {
      try {
        const body = await req.json();
        const results = await retriever.search(body);
        return new Response(JSON.stringify(results), {
          headers: { "Content-Type": "application/json" },
        });
      } catch (e: any) {
        return new Response(JSON.stringify({ error: e.message }), { status: 400 });
      }
    }
    return new Response("Not Found", { status: 404 });
  },
});

console.log(`Search Service running on port ${server.port}`);
