import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { IEngramClient } from "../services/interfaces";

// Allowlist of safe Cypher operations
const SAFE_CYPHER_PATTERNS = [
	/^MATCH\s/i,
	/^OPTIONAL\s+MATCH\s/i,
	/^WITH\s/i,
	/^RETURN\s/i,
	/^ORDER\s+BY\s/i,
	/^LIMIT\s/i,
	/^SKIP\s/i,
	/^WHERE\s/i,
	/^UNWIND\s/i,
	/^CALL\s/i,
];

// Blocklist of dangerous operations
const DANGEROUS_PATTERNS = [
	/\bCREATE\b/i,
	/\bMERGE\b/i,
	/\bDELETE\b/i,
	/\bDETACH\b/i,
	/\bSET\b/i,
	/\bREMOVE\b/i,
	/\bDROP\b/i,
	/\bALTER\b/i,
	/\bCLEAR\b/i,
	/\bIMPORT\b/i,
	/\bEXPORT\b/i,
];

function isReadOnlyCypher(cypher: string): { valid: boolean; reason?: string } {
	const trimmed = cypher.trim();

	// Check for dangerous patterns
	for (const pattern of DANGEROUS_PATTERNS) {
		if (pattern.test(trimmed)) {
			return { valid: false, reason: `Write operation detected: ${pattern.source}` };
		}
	}

	// Check if query starts with a safe pattern
	const startsWithSafe = SAFE_CYPHER_PATTERNS.some((pattern) => pattern.test(trimmed));
	if (!startsWithSafe) {
		return {
			valid: false,
			reason: "Query must start with MATCH, OPTIONAL MATCH, WITH, RETURN, or CALL",
		};
	}

	return { valid: true };
}

export function registerQueryTool(server: McpServer, client: IEngramClient) {
	server.registerTool(
		"query",
		{
			title: "Query Graph",
			description:
				"Query the knowledge graph directly using Cypher for complex lookups that semantic search cannot handle. Use when you need to: find all decisions within a date range, trace relationships between sessions and files, count memories by type, or explore graph structure. Only read operations are allowed.",
			inputSchema: {
				cypher: z
					.string()
					.describe(
						"Cypher query starting with MATCH, WITH, or RETURN. Common patterns: 'MATCH (m:Memory {type: $type}) RETURN m' for filtering, 'MATCH (s:Session)-[:HAS_TURN]->(t:Turn) RETURN s, t' for relationships. All nodes have bitemporal fields (vt_start, vt_end) - filter with 'WHERE n.vt_end > $now' for current data.",
					),
				params: z
					.record(z.string(), z.unknown())
					.optional()
					.describe(
						"Query parameters for safe value injection. Use $paramName in query, provide {paramName: value} here. Always use params for user-provided values to prevent injection. Common params: {now: Date.now()} for temporal filtering, {type: 'decision'} for type filtering.",
					),
			},
			outputSchema: {
				results: z.array(z.record(z.string(), z.unknown())),
				count: z.number(),
			},
		},
		async ({ cypher, params }) => {
			// Validate query is read-only
			const validation = isReadOnlyCypher(cypher);
			if (!validation.valid) {
				return {
					content: [
						{
							type: "text" as const,
							text: JSON.stringify({
								error: `Query rejected: ${validation.reason}`,
								results: [],
								count: 0,
							}),
						},
					],
					isError: true,
				};
			}

			try {
				const result = await client.query(cypher, params ?? {});

				const results = Array.isArray(result) ? result : [];
				const output = {
					results,
					count: results.length,
				};

				return {
					content: [
						{
							type: "text" as const,
							text: JSON.stringify(output, null, 2),
						},
					],
					structuredContent: output,
				};
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				return {
					content: [
						{
							type: "text" as const,
							text: JSON.stringify({
								error: message,
								results: [],
								count: 0,
							}),
						},
					],
					isError: true,
				};
			}
		},
	);
}
