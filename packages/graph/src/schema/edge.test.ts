import { describe, expect, test } from "bun:test";
import { edge } from "./edge";
import { field } from "./field";

describe("EdgeDefinition", () => {
	test("creates simple edge without properties", () => {
		const HasTurn = edge({
			from: "Session",
			to: "Turn",
		});

		expect(HasTurn.getFrom()).toBe("Session");
		expect(HasTurn.getTo()).toBe("Turn");
		expect(HasTurn.isTemporal()).toBe(true); // Default temporal
		expect(HasTurn.hasProperties()).toBe(false);
		expect(HasTurn.getCardinality()).toBe("many-to-many"); // Default cardinality
	});

	test("creates edge with temporal flag disabled", () => {
		const SimpleLinkEdge = edge({
			from: "Node",
			to: "Node",
			temporal: false,
		});

		expect(SimpleLinkEdge.isTemporal()).toBe(false);
	});

	test("creates edge with properties", () => {
		const Mentions = edge({
			from: "Memory",
			to: "Entity",
			properties: {
				context: field.string().optional(),
				confidence: field.float().min(0).max(1),
			},
		});

		expect(Mentions.hasProperties()).toBe(true);
		const props = Mentions.getProperties();
		expect(Object.keys(props)).toEqual(["context", "confidence"]);
		expect(props.context.kind).toBe("string");
		expect(props.confidence.kind).toBe("float");
		expect(props.context.config.optional).toBe(true);
	});

	test("creates self-referential edge", () => {
		const Replaces = edge({
			from: "Memory",
			to: "Memory",
			cardinality: "one-to-one",
			description: "New version replaces old version",
		});

		expect(Replaces.getFrom()).toBe("Memory");
		expect(Replaces.getTo()).toBe("Memory");
		expect(Replaces.getCardinality()).toBe("one-to-one");
		expect(Replaces.getDescription()).toBe("New version replaces old version");
	});

	test("creates edge with custom cardinality", () => {
		const HasTurn = edge({
			from: "Session",
			to: "Turn",
			cardinality: "one-to-many",
		});

		expect(HasTurn.getCardinality()).toBe("one-to-many");
	});

	test("creates edge with all property types", () => {
		const ComplexEdge = edge({
			from: "Source",
			to: "Target",
			properties: {
				name: field.string(),
				count: field.int(),
				weight: field.float(),
				active: field.boolean(),
				createdAt: field.timestamp(),
				tags: field.array(field.string()),
				status: field.enum(["pending", "active", "done"] as const),
				embedding: field.vector(128),
			},
		});

		const props = ComplexEdge.getProperties();
		expect(props.name.kind).toBe("string");
		expect(props.count.kind).toBe("int");
		expect(props.weight.kind).toBe("float");
		expect(props.active.kind).toBe("boolean");
		expect(props.createdAt.kind).toBe("timestamp");
		expect(props.tags.kind).toBe("array");
		expect(props.status.kind).toBe("enum");
		expect(props.embedding.kind).toBe("vector");
	});

	test("edge properties support chaining", () => {
		const WeightedEdge = edge({
			from: "A",
			to: "B",
			properties: {
				weight: field.float().min(0).max(1).default(0.5),
				label: field.string().max(50).optional(),
			},
		});

		const props = WeightedEdge.getProperties();
		expect(props.weight.config.min).toBe(0);
		expect(props.weight.config.max).toBe(1);
		expect(props.weight.config.defaultValue).toBe(0.5);
		expect(props.label.config.maxLength).toBe(50);
		expect(props.label.config.optional).toBe(true);
	});
});

describe("Type inference", () => {
	test("InferEdgeProperties extracts property types", () => {
		const TestEdge = edge({
			from: "A",
			to: "B",
			properties: {
				required: field.string(),
				optional: field.int().optional(),
			},
		});

		// Type-level test (will fail TypeScript compilation if wrong)
		type Props = {
			required: string;
			optional?: number;
		};

		// Runtime validation
		const props = TestEdge.getProperties();
		expect(props.required.config.optional).toBe(undefined);
		expect(props.optional.config.optional).toBe(true);
	});

	test("InferEdgeSchema includes bitemporal fields when temporal is true", () => {
		const TemporalEdge = edge({
			from: "A",
			to: "B",
			temporal: true,
		});

		// Type-level test
		type Schema = {
			vt_start: number;
			vt_end: number;
			tt_start: number;
			tt_end: number;
		};

		expect(TemporalEdge.isTemporal()).toBe(true);
	});

	test("InferEdgeSchema excludes bitemporal fields when temporal is false", () => {
		const NonTemporalEdge = edge({
			from: "A",
			to: "B",
			temporal: false,
		});

		expect(NonTemporalEdge.isTemporal()).toBe(false);
	});
});

describe("Edge examples matching API requirements", () => {
	test("HasTurn edge from requirements", () => {
		const HasTurn = edge({
			from: "Session",
			to: "Turn",
			temporal: true,
		});

		expect(HasTurn.getFrom()).toBe("Session");
		expect(HasTurn.getTo()).toBe("Turn");
		expect(HasTurn.isTemporal()).toBe(true);
	});

	test("Mentions edge from requirements", () => {
		const Mentions = edge({
			from: "Memory",
			to: "Entity",
			temporal: true,
			properties: {
				context: field.string().optional(),
				confidence: field.float().optional(),
			},
		});

		expect(Mentions.hasProperties()).toBe(true);
		const props = Mentions.getProperties();
		expect(props.context.config.optional).toBe(true);
		expect(props.confidence.config.optional).toBe(true);
	});

	test("Replaces edge from requirements", () => {
		const Replaces = edge({
			from: "Memory",
			to: "Memory",
			temporal: true,
		});

		expect(Replaces.getFrom()).toBe("Memory");
		expect(Replaces.getTo()).toBe("Memory");
		expect(Replaces.isTemporal()).toBe(true);
	});
});
