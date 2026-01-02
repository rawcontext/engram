/**
 * Tests for node schema validation.
 */

import { describe, expect, test } from "bun:test";
import {
	ConflictReportNodeSchema,
	ConflictReportRelationEnum,
	ConflictReportStatusEnum,
	ConflictResolutionActionEnum,
} from "./nodes";

describe("ConflictReportNodeSchema", () => {
	const validConflictReport = {
		id: "01JNNXYZ1234567890ABCDEFGH",
		labels: ["ConflictReport"] as const,
		source_memory_id: "01JNNXYZ1111111111111111AA",
		target_memory_id: "01JNNXYZ2222222222222222BB",
		relation: "CONTRADICTION" as const,
		reason: "Memory A states X is true, Memory B states X is false",
		detected_at: Date.now(),
		status: "pending_review" as const,
		project: "engram",
		org_id: "org_12345",
		vt_start: Date.now(),
		vt_end: Number.MAX_SAFE_INTEGER,
		tt_start: Date.now(),
		tt_end: Number.MAX_SAFE_INTEGER,
	};

	test("should validate a complete conflict report", () => {
		const result = ConflictReportNodeSchema.safeParse(validConflictReport);
		expect(result.success).toBe(true);
	});

	test("should validate all relation types", () => {
		for (const relation of ["CONTRADICTION", "SUPERSEDES", "INDEPENDENT"] as const) {
			const report = { ...validConflictReport, relation };
			const result = ConflictReportNodeSchema.safeParse(report);
			expect(result.success).toBe(true);
		}
	});

	test("should reject invalid relation types", () => {
		const report = { ...validConflictReport, relation: "INVALID" };
		const result = ConflictReportNodeSchema.safeParse(report);
		expect(result.success).toBe(false);
	});

	test("should validate all status types", () => {
		for (const status of ["pending_review", "resolved", "dismissed"] as const) {
			const report = { ...validConflictReport, status };
			const result = ConflictReportNodeSchema.safeParse(report);
			expect(result.success).toBe(true);
		}
	});

	test("should default status to pending_review", () => {
		const { status, ...withoutStatus } = validConflictReport;
		const result = ConflictReportNodeSchema.parse(withoutStatus);
		expect(result.status).toBe("pending_review");
	});

	test("should accept optional resolution fields when resolved", () => {
		const resolvedReport = {
			...validConflictReport,
			status: "resolved" as const,
			resolved_by: "user_123",
			resolved_at: Date.now(),
			resolution_action: "invalidate_target" as const,
		};
		const result = ConflictReportNodeSchema.safeParse(resolvedReport);
		expect(result.success).toBe(true);
	});

	test("should validate all resolution action types", () => {
		for (const action of ["invalidate_source", "invalidate_target", "keep_both"] as const) {
			const report = {
				...validConflictReport,
				status: "resolved" as const,
				resolution_action: action,
			};
			const result = ConflictReportNodeSchema.safeParse(report);
			expect(result.success).toBe(true);
		}
	});

	test("should require memory IDs", () => {
		const { source_memory_id, ...withoutSource } = validConflictReport;
		expect(ConflictReportNodeSchema.safeParse(withoutSource).success).toBe(false);

		const { target_memory_id, ...withoutTarget } = validConflictReport;
		expect(ConflictReportNodeSchema.safeParse(withoutTarget).success).toBe(false);
	});

	test("should require project and org_id", () => {
		const { project, ...withoutProject } = validConflictReport;
		expect(ConflictReportNodeSchema.safeParse(withoutProject).success).toBe(false);

		const { org_id, ...withoutOrg } = validConflictReport;
		expect(ConflictReportNodeSchema.safeParse(withoutOrg).success).toBe(false);
	});

	test("should require bitemporal fields", () => {
		const { vt_start, ...withoutVtStart } = validConflictReport;
		expect(ConflictReportNodeSchema.safeParse(withoutVtStart).success).toBe(false);

		const { tt_end, ...withoutTtEnd } = validConflictReport;
		expect(ConflictReportNodeSchema.safeParse(withoutTtEnd).success).toBe(false);
	});
});

describe("ConflictReportRelationEnum", () => {
	test("should parse valid relations", () => {
		expect(ConflictReportRelationEnum.parse("CONTRADICTION")).toBe("CONTRADICTION");
		expect(ConflictReportRelationEnum.parse("SUPERSEDES")).toBe("SUPERSEDES");
		expect(ConflictReportRelationEnum.parse("INDEPENDENT")).toBe("INDEPENDENT");
	});

	test("should reject lowercase variants", () => {
		expect(() => ConflictReportRelationEnum.parse("contradiction")).toThrow();
	});
});

describe("ConflictReportStatusEnum", () => {
	test("should parse valid statuses", () => {
		expect(ConflictReportStatusEnum.parse("pending_review")).toBe("pending_review");
		expect(ConflictReportStatusEnum.parse("resolved")).toBe("resolved");
		expect(ConflictReportStatusEnum.parse("dismissed")).toBe("dismissed");
	});
});

describe("ConflictResolutionActionEnum", () => {
	test("should parse valid actions", () => {
		expect(ConflictResolutionActionEnum.parse("invalidate_source")).toBe("invalidate_source");
		expect(ConflictResolutionActionEnum.parse("invalidate_target")).toBe("invalidate_target");
		expect(ConflictResolutionActionEnum.parse("keep_both")).toBe("keep_both");
	});
});
