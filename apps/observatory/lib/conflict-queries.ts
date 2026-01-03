import { createFalkorClient, type FalkorNode, type QueryParams } from "@engram/storage/falkor";

// Singleton FalkorDB client
const falkor = createFalkorClient();

// =============================================================================
// Type Definitions
// =============================================================================

export interface ConflictReport {
	id: string;
	memoryIdA: string;
	memoryIdB: string;
	relation: string;
	confidence: number;
	reasoning: string;
	modelUsed: string;
	status: string;
	reviewedAt?: number;
	reviewedBy?: string;
	suggestedAction: string;
	resolutionAction?: string;
	scanId: string;
	scannedAt: number;
	orgId: string;
	project?: string;
	// Bitemporal
	vtStart: number;
	vtEnd: number;
	ttStart: number;
	ttEnd: number;
}

export interface Memory {
	id: string;
	content: string;
	type: string;
	tags: string[];
	project?: string;
	vtStart: number;
	vtEnd: number;
}

export interface ConflictWithMemories extends ConflictReport {
	memoryA?: Memory;
	memoryB?: Memory;
}

export interface ConflictStats {
	pending: number;
	confirmed: number;
	dismissed: number;
	autoResolved: number;
}

type ConflictReportNodeProps = {
	id: string;
	memory_id_a: string;
	memory_id_b: string;
	relation: string;
	confidence: number;
	reasoning: string;
	model_used: string;
	status: string;
	reviewed_at?: number;
	reviewed_by?: string;
	suggested_action: string;
	resolution_action?: string;
	scan_id: string;
	scanned_at: number;
	org_id: string;
	project?: string;
	vt_start: number;
	vt_end: number;
	tt_start: number;
	tt_end: number;
	[key: string]: unknown;
};

type MemoryNodeProps = {
	id: string;
	content: string;
	type: string;
	tags: string[];
	project?: string;
	vt_start: number;
	vt_end: number;
	[key: string]: unknown;
};

const MAX_DATE = 253402300799000;

// =============================================================================
// Query Functions
// =============================================================================

/**
 * Get conflict reports with optional filters
 */
export async function getConflictReports(options: {
	orgId: string;
	status?: string;
	project?: string;
	limit?: number;
	offset?: number;
}): Promise<{ conflicts: ConflictWithMemories[]; total: number }> {
	const { orgId, status, project, limit = 50, offset = 0 } = options;

	await falkor.connect();

	// Build WHERE clause
	const conditions: string[] = [`c.tt_end = ${MAX_DATE}`, `c.org_id = $orgId`];
	const params: QueryParams = { orgId };

	if (status) {
		conditions.push(`c.status = $status`);
		params.status = status;
	}

	if (project) {
		conditions.push(`c.project = $project`);
		params.project = project;
	}

	const whereClause = conditions.join(" AND ");

	// Get total count
	const countQuery = `
		MATCH (c:ConflictReport)
		WHERE ${whereClause}
		RETURN count(c) as total
	`;
	const countResult = await falkor.query<{ total: number }>(countQuery, params);
	const total = countResult?.[0]?.total ?? 0;

	// Get conflict reports
	const query = `
		MATCH (c:ConflictReport)
		WHERE ${whereClause}
		RETURN c
		ORDER BY c.scanned_at DESC
		SKIP ${offset} LIMIT ${limit}
	`;

	const result = await falkor.query<{ c: FalkorNode<ConflictReportNodeProps> }>(query, params);

	const conflicts: ConflictWithMemories[] = [];

	if (Array.isArray(result)) {
		for (const row of result) {
			if (row.c?.properties) {
				const conflict = mapToConflictReport(row.c);

				// Fetch associated memories
				const [memoryA, memoryB] = await Promise.all([
					getMemoryById(conflict.memoryIdA),
					getMemoryById(conflict.memoryIdB),
				]);

				conflicts.push({
					...conflict,
					memoryA: memoryA ?? undefined,
					memoryB: memoryB ?? undefined,
				});
			}
		}
	}

	return { conflicts, total };
}

/**
 * Get a single conflict report by ID
 */
export async function getConflictById(id: string): Promise<ConflictWithMemories | null> {
	await falkor.connect();

	const query = `
		MATCH (c:ConflictReport {id: $id})
		WHERE c.tt_end = ${MAX_DATE}
		RETURN c
	`;

	const result = await falkor.query<{ c: FalkorNode<ConflictReportNodeProps> }>(query, { id });

	if (!result?.[0]?.c?.properties) {
		return null;
	}

	const conflict = mapToConflictReport(result[0].c);

	const [memoryA, memoryB] = await Promise.all([
		getMemoryById(conflict.memoryIdA),
		getMemoryById(conflict.memoryIdB),
	]);

	return {
		...conflict,
		memoryA: memoryA ?? undefined,
		memoryB: memoryB ?? undefined,
	};
}

/**
 * Get memory by ID
 */
async function getMemoryById(id: string): Promise<Memory | null> {
	const query = `
		MATCH (m:Memory {id: $id})
		WHERE m.tt_end = ${MAX_DATE}
		RETURN m
	`;

	const result = await falkor.query<{ m: FalkorNode<MemoryNodeProps> }>(query, { id });

	if (!result?.[0]?.m?.properties) {
		return null;
	}

	const props = result[0].m.properties;
	return {
		id: props.id,
		content: props.content,
		type: props.type,
		tags: props.tags || [],
		project: props.project,
		vtStart: props.vt_start,
		vtEnd: props.vt_end,
	};
}

/**
 * Resolve a conflict report
 */
export async function resolveConflictReport(
	id: string,
	input: {
		status: "confirmed" | "dismissed" | "auto_resolved";
		reviewedBy?: string;
		resolutionAction?: "invalidate_a" | "invalidate_b" | "keep_both" | "merge";
	},
): Promise<ConflictReport> {
	await falkor.connect();

	const now = Date.now();
	const updates: string[] = [`c.status = $status`, `c.reviewed_at = ${now}`];
	const params: QueryParams = {
		id,
		status: input.status,
	};

	if (input.reviewedBy) {
		updates.push(`c.reviewed_by = $reviewedBy`);
		params.reviewedBy = input.reviewedBy;
	}

	if (input.resolutionAction) {
		updates.push(`c.resolution_action = $resolutionAction`);
		params.resolutionAction = input.resolutionAction;
	}

	const query = `
		MATCH (c:ConflictReport {id: $id})
		WHERE c.tt_end = ${MAX_DATE}
		SET ${updates.join(", ")}
		RETURN c
	`;

	const result = await falkor.query<{ c: FalkorNode<ConflictReportNodeProps> }>(query, params);

	if (!result?.[0]?.c?.properties) {
		throw new Error(`ConflictReport not found: ${id}`);
	}

	return mapToConflictReport(result[0].c);
}

/**
 * Get conflict statistics for an organization
 */
export async function getConflictStats(orgId: string): Promise<ConflictStats> {
	await falkor.connect();

	const query = `
		MATCH (c:ConflictReport {org_id: $orgId})
		WHERE c.tt_end = ${MAX_DATE}
		RETURN c.status as status, count(c) as count
	`;

	const result = await falkor.query<{ status: string; count: number }>(query, { orgId });

	const stats: ConflictStats = {
		pending: 0,
		confirmed: 0,
		dismissed: 0,
		autoResolved: 0,
	};

	if (Array.isArray(result)) {
		for (const row of result) {
			switch (row.status) {
				case "pending_review":
					stats.pending = row.count;
					break;
				case "confirmed":
					stats.confirmed = row.count;
					break;
				case "dismissed":
					stats.dismissed = row.count;
					break;
				case "auto_resolved":
					stats.autoResolved = row.count;
					break;
			}
		}
	}

	return stats;
}

/**
 * Invalidate a memory (close its vt_end)
 */
export async function invalidateMemory(id: string): Promise<void> {
	await falkor.connect();

	const now = Date.now();

	const query = `
		MATCH (m:Memory {id: $id})
		WHERE m.tt_end = ${MAX_DATE}
		SET m.vt_end = ${now}
		RETURN m
	`;

	await falkor.query(query, { id });
}

// =============================================================================
// Helpers
// =============================================================================

function mapToConflictReport(node: FalkorNode<ConflictReportNodeProps>): ConflictReport {
	const props = node.properties;
	return {
		id: props.id,
		memoryIdA: props.memory_id_a,
		memoryIdB: props.memory_id_b,
		relation: props.relation,
		confidence: props.confidence,
		reasoning: props.reasoning,
		modelUsed: props.model_used,
		status: props.status,
		reviewedAt: props.reviewed_at,
		reviewedBy: props.reviewed_by,
		suggestedAction: props.suggested_action,
		resolutionAction: props.resolution_action,
		scanId: props.scan_id,
		scannedAt: props.scanned_at,
		orgId: props.org_id,
		project: props.project,
		vtStart: props.vt_start,
		vtEnd: props.vt_end,
		ttStart: props.tt_start,
		ttEnd: props.tt_end,
	};
}
