import type { FalkorClient } from "@engram/storage";

async function testQuery(falkor: FalkorClient) {
	return falkor.query(`MATCH (m:Memry) RETURN m`);
}
