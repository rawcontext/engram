import { QdrantClient } from "@qdrant/js-client-rest";
import { beforeAll, describe, expect, it } from "bun:test";
import { createFalkorClient } from "../../packages/storage/src/index";

// Real Clients
const falkor = createFalkorClient();
const qdrant = new QdrantClient({ url: "http://localhost:6333" });

describe("Infrastructure E2E", () => {
	beforeAll(async () => {
		// Wait for services to be ready
		await new Promise((resolve) => setTimeout(resolve, 5000));
	});

	it("should connect to FalkorDB and run query via Wrapper", async () => {
		await falkor.connect();
		try {
			// Create a node
			// Note: The wrapper does simple regex replacement for params $id.
			const query = "CREATE (:Person {name: 'WrapperTest'}) RETURN 'Success'";
			const res = await falkor.query(query);
			// Check if response array contains "Success"
			expect(JSON.stringify(res)).toContain("Success");
		} finally {
			await falkor.disconnect();
		}
	});

	it("should connect to Qdrant and list collections", async () => {
		const res = await qdrant.getCollections();
		expect(res).toHaveProperty("collections");
	});
});
