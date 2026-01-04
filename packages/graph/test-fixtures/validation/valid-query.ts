import type { FalkorClient } from "@engram/storage";

async function testQuery(falkor: FalkorClient) {
	return falkor.query(`MATCH (m:Memory) RETURN m`);
}

export { testQuery };
