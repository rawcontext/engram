import { describe, expect, it } from "bun:test";
import {
	type Communities,
	type Graph,
	getCommunityForNode,
	graphFromEdges,
	labelPropagation,
	mergeCommunities,
} from "../label-propagation";

describe("labelPropagation", () => {
	describe("basic functionality", () => {
		it("should return empty object for empty graph", () => {
			const graph: Graph = { nodes: new Map() };
			const result = labelPropagation(graph);
			expect(result).toEqual({});
		});

		it("should handle single node", () => {
			const graph: Graph = { nodes: new Map([["a", new Set()]]) };
			const result = labelPropagation(graph, { minCommunitySize: 1 });
			expect(Object.keys(result)).toHaveLength(1);
			expect(Object.values(result).flat()).toContain("a");
		});

		it("should find community in 3-node triangle", () => {
			const graph = graphFromEdges([
				["a", "b"],
				["b", "c"],
				["c", "a"],
			]);

			const result = labelPropagation(graph, { seed: 42 });

			// All 3 nodes should be in same community
			expect(Object.keys(result)).toHaveLength(1);
			const community = Object.values(result)[0];
			expect(community).toHaveLength(3);
			expect(community.sort()).toEqual(["a", "b", "c"]);
		});

		it("should find communities with deterministic seed", () => {
			const graph = graphFromEdges([
				["a", "b"],
				["b", "c"],
				["c", "a"],
				["d", "e"],
				["e", "f"],
				["f", "d"],
			]);

			// Run multiple times with same seed
			const results = [
				labelPropagation(graph, { seed: 123 }),
				labelPropagation(graph, { seed: 123 }),
				labelPropagation(graph, { seed: 123 }),
			];

			// All results should be identical
			expect(results[0]).toEqual(results[1]);
			expect(results[1]).toEqual(results[2]);
		});
	});

	describe("disconnected components", () => {
		it("should find separate communities for disconnected cliques", () => {
			// Two triangles that are not connected
			const graph = graphFromEdges([
				["a", "b"],
				["b", "c"],
				["c", "a"],
				["x", "y"],
				["y", "z"],
				["z", "x"],
			]);

			const result = labelPropagation(graph, { seed: 42 });

			// Should have 2 communities
			expect(Object.keys(result)).toHaveLength(2);

			// Find which community each node is in
			const allNodes = Object.values(result).flat();
			expect(allNodes.sort()).toEqual(["a", "b", "c", "x", "y", "z"]);

			// a, b, c should be in same community
			const communityA = getCommunityForNode(result, "a");
			const communityB = getCommunityForNode(result, "b");
			const communityC = getCommunityForNode(result, "c");
			expect(communityA).toBe(communityB);
			expect(communityB).toBe(communityC);

			// x, y, z should be in same community
			const communityX = getCommunityForNode(result, "x");
			const communityY = getCommunityForNode(result, "y");
			const communityZ = getCommunityForNode(result, "z");
			expect(communityX).toBe(communityY);
			expect(communityY).toBe(communityZ);

			// But the two groups should be in different communities
			expect(communityA).not.toBe(communityX);
		});

		it("should handle many disconnected pairs (filtered by min size)", () => {
			// 5 pairs of connected nodes (each pair is a component of size 2)
			const graph = graphFromEdges([
				["a1", "a2"],
				["b1", "b2"],
				["c1", "c2"],
				["d1", "d2"],
				["e1", "e2"],
			]);

			// Default minCommunitySize=3 should filter all
			const result = labelPropagation(graph);
			expect(Object.keys(result)).toHaveLength(0);

			// With minCommunitySize=2 should return 5 communities
			const result2 = labelPropagation(graph, { minCommunitySize: 2 });
			expect(Object.keys(result2)).toHaveLength(5);
		});
	});

	describe("singleton handling", () => {
		it("should filter out isolated nodes (singletons)", () => {
			const graph: Graph = {
				nodes: new Map([
					["a", new Set(["b", "c"])],
					["b", new Set(["a", "c"])],
					["c", new Set(["a", "b"])],
					["lonely", new Set()], // Isolated node
				]),
			};

			const result = labelPropagation(graph);

			// Triangle should form one community
			expect(Object.keys(result)).toHaveLength(1);
			const community = Object.values(result)[0];
			expect(community).not.toContain("lonely");
			expect(community.sort()).toEqual(["a", "b", "c"]);
		});

		it("should include singletons with minCommunitySize=1", () => {
			const graph: Graph = {
				nodes: new Map([
					["a", new Set(["b"])],
					["b", new Set(["a"])],
					["lonely", new Set()],
				]),
			};

			const result = labelPropagation(graph, { minCommunitySize: 1 });

			// Should have 2 communities: pair and singleton
			expect(Object.keys(result).length).toBeGreaterThanOrEqual(2);
			const allNodes = Object.values(result).flat();
			expect(allNodes).toContain("lonely");
		});
	});

	describe("iteration limit", () => {
		it("should respect maxIterations", () => {
			// Create a larger graph that might take more iterations
			const edges: [string, string][] = [];
			for (let i = 0; i < 20; i++) {
				edges.push([`n${i}`, `n${(i + 1) % 20}`]);
			}
			const graph = graphFromEdges(edges);

			// Should complete without hanging even with low iteration limit
			const start = performance.now();
			const result = labelPropagation(graph, { maxIterations: 5, minCommunitySize: 1 });
			const elapsed = performance.now() - start;

			expect(elapsed).toBeLessThan(1000); // Should be very fast
			expect(Object.values(result).flat()).toHaveLength(20);
		});

		it("should converge before maxIterations on simple graphs", () => {
			const graph = graphFromEdges([
				["a", "b"],
				["b", "c"],
				["c", "a"],
			]);

			// Even with high limit, should converge quickly
			const result = labelPropagation(graph, { maxIterations: 1000, seed: 42 });
			expect(Object.keys(result)).toHaveLength(1);
		});
	});

	describe("large graphs", () => {
		it("should handle graph with 100 nodes", () => {
			// Create 10 cliques of 10 nodes each
			const edges: [string, string][] = [];
			for (let clique = 0; clique < 10; clique++) {
				for (let i = 0; i < 10; i++) {
					for (let j = i + 1; j < 10; j++) {
						edges.push([`c${clique}_n${i}`, `c${clique}_n${j}`]);
					}
				}
			}
			const graph = graphFromEdges(edges);

			const result = labelPropagation(graph, { seed: 42 });

			// Should find ~10 communities (one per clique)
			expect(Object.keys(result).length).toBe(10);

			// Each community should have 10 nodes
			for (const members of Object.values(result)) {
				expect(members).toHaveLength(10);
			}
		});

		it("should handle dense random graph", () => {
			// Create random graph with 50 nodes
			const nodes = Array.from({ length: 50 }, (_, i) => `n${i}`);
			const edges: [string, string][] = [];

			// Add random edges with seed-based pseudo-random
			let seed = 12345;
			const random = () => {
				seed = (seed * 1103515245 + 12345) & 0x7fffffff;
				return seed / 0x7fffffff;
			};

			for (let i = 0; i < nodes.length; i++) {
				for (let j = i + 1; j < nodes.length; j++) {
					if (random() < 0.1) {
						// 10% edge probability
						edges.push([nodes[i], nodes[j]]);
					}
				}
			}
			const graph = graphFromEdges(edges);

			const start = performance.now();
			const result = labelPropagation(graph, { seed: 42, minCommunitySize: 2 });
			const elapsed = performance.now() - start;

			// Should complete quickly
			expect(elapsed).toBeLessThan(1000);

			// Result should be valid
			const allNodes = Object.values(result).flat();
			// All returned nodes should be from original graph
			for (const node of allNodes) {
				expect(graph.nodes.has(node)).toBe(true);
			}
		});
	});

	describe("community structure", () => {
		it("should detect dumbbell graph communities", () => {
			// Two triangles connected by single edge (dumbbell/barbell graph)
			const graph = graphFromEdges([
				// Left clique
				["l1", "l2"],
				["l2", "l3"],
				["l3", "l1"],
				// Right clique
				["r1", "r2"],
				["r2", "r3"],
				["r3", "r1"],
				// Bridge
				["l1", "r1"],
			]);

			const result = labelPropagation(graph, { seed: 42 });

			// Depending on seed, might merge or separate
			// Either 1 community with all 6, or 2 communities with 3 each
			const totalNodes = Object.values(result).flat().length;
			expect(totalNodes).toBe(6);

			// If 2 communities, they should be the cliques
			if (Object.keys(result).length === 2) {
				const communities = Object.values(result);
				const sorted = communities.map((c) => c.sort());
				expect(sorted).toContainEqual(["l1", "l2", "l3"]);
				expect(sorted).toContainEqual(["r1", "r2", "r3"]);
			}
		});
	});
});

describe("graphFromEdges", () => {
	it("should create undirected graph from edges", () => {
		const graph = graphFromEdges([["a", "b"]]);

		expect(graph.nodes.get("a")?.has("b")).toBe(true);
		expect(graph.nodes.get("b")?.has("a")).toBe(true);
	});

	it("should handle self-loops", () => {
		const graph = graphFromEdges([["a", "a"]]);
		expect(graph.nodes.get("a")?.has("a")).toBe(true);
	});

	it("should handle duplicate edges", () => {
		const graph = graphFromEdges([
			["a", "b"],
			["a", "b"],
			["b", "a"],
		]);

		expect(graph.nodes.get("a")?.size).toBe(1);
		expect(graph.nodes.get("b")?.size).toBe(1);
	});

	it("should handle empty edge list", () => {
		const graph = graphFromEdges([]);
		expect(graph.nodes.size).toBe(0);
	});
});

describe("getCommunityForNode", () => {
	it("should find community for node", () => {
		const communities: Communities = {
			group1: ["a", "b", "c"],
			group2: ["x", "y", "z"],
		};

		expect(getCommunityForNode(communities, "a")).toBe("group1");
		expect(getCommunityForNode(communities, "y")).toBe("group2");
	});

	it("should return undefined for unknown node", () => {
		const communities: Communities = {
			group1: ["a", "b"],
		};

		expect(getCommunityForNode(communities, "unknown")).toBeUndefined();
	});
});

describe("mergeCommunities", () => {
	it("should merge overlapping communities", () => {
		const existing: Communities = {
			old: ["a", "b", "c"],
		};
		const newCommunities: Communities = {
			new: ["b", "c", "d"],
		};

		const result = mergeCommunities(existing, newCommunities, 0.5);

		// Should merge into single community since overlap > 50%
		expect(Object.keys(result)).toHaveLength(1);
		const merged = Object.values(result)[0];
		expect(merged.sort()).toEqual(["a", "b", "c", "d"]);
	});

	it("should create new community for non-overlapping", () => {
		const existing: Communities = {
			old: ["a", "b", "c"],
		};
		const newCommunities: Communities = {
			new: ["x", "y", "z"],
		};

		const result = mergeCommunities(existing, newCommunities, 0.5);

		// Should have 2 communities
		expect(Object.keys(result)).toHaveLength(2);
	});

	it("should respect overlap threshold", () => {
		const existing: Communities = {
			old: ["a", "b", "c", "d", "e"],
		};
		const newCommunities: Communities = {
			new: ["a", "x", "y", "z"],
		};

		// Overlap is 1/4 = 25%, should not merge with 50% threshold
		const result50 = mergeCommunities(existing, newCommunities, 0.5);
		expect(Object.keys(result50)).toHaveLength(2);

		// Should merge with 20% threshold
		const result20 = mergeCommunities(existing, newCommunities, 0.2);
		expect(Object.keys(result20)).toHaveLength(1);
	});

	it("should handle empty existing communities", () => {
		const existing: Communities = {};
		const newCommunities: Communities = {
			new: ["a", "b", "c"],
		};

		const result = mergeCommunities(existing, newCommunities);
		expect(result).toEqual({ new: ["a", "b", "c"] });
	});

	it("should handle empty new communities", () => {
		const existing: Communities = {
			old: ["a", "b", "c"],
		};
		const newCommunities: Communities = {};

		const result = mergeCommunities(existing, newCommunities);
		expect(result).toEqual(existing);
	});
});
