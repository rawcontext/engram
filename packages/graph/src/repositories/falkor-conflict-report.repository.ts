import { createNodeLogger } from "@engram/logger";
import type { FalkorNode } from "@engram/storage";
import type { ConflictReportRepository } from "./conflict-report.repository";
import { FalkorBaseRepository } from "./falkor-base";
import type {
	ConflictReport,
	CreateConflictReportInput,
	ResolveConflictReportInput,
} from "./types";

const _logger = createNodeLogger({
	service: "graph",
	base: { component: "falkor-conflict-report-repository" },
});

/**
 * Raw FalkorDB ConflictReport node properties.
 */
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
	// Bitemporal
	vt_start: number;
	vt_end: number;
	tt_start: number;
	tt_end: number;
	[key: string]: unknown;
};

/**
 * FalkorDB implementation of ConflictReportRepository.
 * Supports both legacy (single-tenant) and multi-tenant modes via TenantContext.
 */
export class FalkorConflictReportRepository
	extends FalkorBaseRepository
	implements ConflictReportRepository
{
	async findById(id: string): Promise<ConflictReport | null> {
		const results = await this.query<{ c: FalkorNode<ConflictReportNodeProps> }>(
			`MATCH (c:ConflictReport {id: $id}) WHERE c.tt_end = ${this.maxDate} RETURN c`,
			{ id },
		);
		if (!results[0]?.c) return null;
		return this.mapToConflictReport(results[0].c);
	}

	async findByProject(project: string): Promise<ConflictReport[]> {
		const results = await this.query<{ c: FalkorNode<ConflictReportNodeProps> }>(
			`MATCH (c:ConflictReport {project: $project})
			 WHERE c.tt_end = ${this.maxDate}
			 RETURN c ORDER BY c.scanned_at DESC`,
			{ project },
		);
		return results.map((r) => this.mapToConflictReport(r.c));
	}

	async findPending(orgId: string, project?: string): Promise<ConflictReport[]> {
		const projectFilter = project ? " AND c.project = $project" : "";
		const results = await this.query<{ c: FalkorNode<ConflictReportNodeProps> }>(
			`MATCH (c:ConflictReport {org_id: $orgId, status: 'pending_review'})
			 WHERE c.tt_end = ${this.maxDate}${projectFilter}
			 RETURN c ORDER BY c.scanned_at DESC`,
			{ orgId, project },
		);
		return results.map((r) => this.mapToConflictReport(r.c));
	}

	async findByMemoryId(memoryId: string): Promise<ConflictReport[]> {
		const results = await this.query<{ c: FalkorNode<ConflictReportNodeProps> }>(
			`MATCH (c:ConflictReport)
			 WHERE c.tt_end = ${this.maxDate}
			   AND (c.memory_id_a = $memoryId OR c.memory_id_b = $memoryId)
			 RETURN c ORDER BY c.scanned_at DESC`,
			{ memoryId },
		);
		return results.map((r) => this.mapToConflictReport(r.c));
	}

	async create(input: CreateConflictReportInput): Promise<ConflictReport> {
		const id = this.generateId();
		const temporal = this.createBitemporal();

		const nodeProps: Record<string, unknown> = {
			id,
			memory_id_a: input.memoryIdA,
			memory_id_b: input.memoryIdB,
			relation: input.relation,
			confidence: input.confidence,
			reasoning: input.reasoning,
			model_used: input.modelUsed,
			status: "pending_review",
			suggested_action: input.suggestedAction,
			scan_id: input.scanId,
			scanned_at: input.scannedAt,
			org_id: input.orgId,
			// Bitemporal
			vt_start: temporal.vt_start,
			vt_end: temporal.vt_end,
			tt_start: temporal.tt_start,
			tt_end: temporal.tt_end,
		};

		if (input.project) nodeProps.project = input.project;

		const propsString = this.buildPropertyString(nodeProps);
		const results = await this.query<{ c: FalkorNode<ConflictReportNodeProps> }>(
			`CREATE (c:ConflictReport {${propsString}}) RETURN c`,
			nodeProps,
		);

		return this.mapToConflictReport(results[0].c);
	}

	async createMany(inputs: CreateConflictReportInput[]): Promise<ConflictReport[]> {
		if (inputs.length === 0) return [];

		// Create all reports in sequence (FalkorDB doesn't have UNWIND for node creation)
		const reports: ConflictReport[] = [];
		for (const input of inputs) {
			const report = await this.create(input);
			reports.push(report);
		}
		return reports;
	}

	async resolve(id: string, input: ResolveConflictReportInput): Promise<ConflictReport> {
		const existing = await this.findById(id);
		if (!existing) {
			throw new Error(`ConflictReport not found: ${id}`);
		}

		const t = this.now;
		const updates: Record<string, unknown> = {
			status: input.status,
			reviewed_at: t,
		};

		if (input.reviewedBy) updates.reviewed_by = input.reviewedBy;
		if (input.resolutionAction) updates.resolution_action = input.resolutionAction;

		const setClause = this.buildSetClause(updates, "c");
		await this.query(
			`MATCH (c:ConflictReport {id: $id})
			 WHERE c.tt_end = ${this.maxDate}
			 SET ${setClause}`,
			{ id, ...updates },
		);

		const updated = await this.findById(id);
		if (!updated) {
			throw new Error(`Failed to update ConflictReport: ${id}`);
		}
		return updated;
	}

	async dismiss(id: string, reviewedBy: string): Promise<ConflictReport> {
		return this.resolve(id, {
			status: "dismissed",
			reviewedBy,
		});
	}

	async findActive(orgId: string): Promise<ConflictReport[]> {
		const results = await this.query<{ c: FalkorNode<ConflictReportNodeProps> }>(
			`MATCH (c:ConflictReport {org_id: $orgId})
			 WHERE c.tt_end = ${this.maxDate}
			 RETURN c ORDER BY c.scanned_at DESC`,
			{ orgId },
		);
		return results.map((r) => this.mapToConflictReport(r.c));
	}

	async getStats(orgId: string): Promise<{
		pending: number;
		confirmed: number;
		dismissed: number;
		autoResolved: number;
	}> {
		const results = await this.query<{ status: string; count: number }>(
			`MATCH (c:ConflictReport {org_id: $orgId})
			 WHERE c.tt_end = ${this.maxDate}
			 RETURN c.status as status, count(c) as count`,
			{ orgId },
		);

		const stats = {
			pending: 0,
			confirmed: 0,
			dismissed: 0,
			autoResolved: 0,
		};

		for (const row of results) {
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

		return stats;
	}

	async delete(id: string): Promise<void> {
		const exists = await this.findById(id);
		if (!exists) {
			throw new Error(`ConflictReport not found: ${id}`);
		}
		await this.softDelete("ConflictReport", id);
	}

	/**
	 * Map FalkorDB node to domain ConflictReport object.
	 */
	private mapToConflictReport(node: FalkorNode<ConflictReportNodeProps>): ConflictReport {
		if (!node || !node.properties) {
			throw new Error("Invalid node: node or properties is null/undefined");
		}
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
			// Bitemporal
			vtStart: props.vt_start,
			vtEnd: props.vt_end,
			ttStart: props.tt_start,
			ttEnd: props.tt_end,
		};
	}
}
