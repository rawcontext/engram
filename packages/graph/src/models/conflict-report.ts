import { z } from "zod";
import { BaseNodeSchema } from "./base";
import { ConflictRelationEnum } from "./conflict-decision";

// =============================================================================
// ConflictReportStatus - Review status for background-detected conflicts
// =============================================================================
export const ConflictReportStatus = {
	/** Awaiting user review */
	PENDING_REVIEW: "pending_review",
	/** User confirmed the conflict and memory was invalidated */
	CONFIRMED: "confirmed",
	/** User dismissed the conflict as a false positive */
	DISMISSED: "dismissed",
	/** Auto-resolved by system (e.g., memory already invalidated) */
	AUTO_RESOLVED: "auto_resolved",
} as const;

export type ConflictReportStatusValue =
	(typeof ConflictReportStatus)[keyof typeof ConflictReportStatus];

export const ConflictReportStatusEnum = z.enum([
	"pending_review",
	"confirmed",
	"dismissed",
	"auto_resolved",
]);

// =============================================================================
// ConflictReportNode: Background-detected memory conflicts pending review
// Created by the weekly conflict scanner, not auto-invalidated
// =============================================================================
export const ConflictReportNodeSchema = BaseNodeSchema.extend({
	labels: z.tuple([z.literal("ConflictReport")]),

	// Memory references
	memoryIdA: z.string(), // ULID of first memory (typically older)
	memoryIdB: z.string(), // ULID of second memory (typically newer)

	// Conflict analysis from LLM
	relation: ConflictRelationEnum, // Type of relationship detected
	confidence: z.number().min(0).max(1), // LLM confidence score
	reasoning: z.string(), // LLM explanation of the conflict

	// Model attribution
	modelUsed: z.string(), // e.g., "gemini-2.0-flash", "gemini-3-flash-preview"

	// Review status
	status: ConflictReportStatusEnum.default("pending_review"),
	reviewedAt: z.number().optional(), // Epoch ms when reviewed
	reviewedBy: z.string().optional(), // User ID who reviewed

	// Suggested action
	suggestedAction: z.enum(["invalidate_a", "invalidate_b", "keep_both", "merge"]),

	// Scan metadata
	scanId: z.string(), // Execution ID of the scan job
	scannedAt: z.number(), // Epoch ms when conflict was detected

	// Multi-tenancy
	orgId: z.string(), // Organization ID for filtering
	project: z.string().optional(), // Optional project filter
});

export type ConflictReportNode = z.infer<typeof ConflictReportNodeSchema>;
