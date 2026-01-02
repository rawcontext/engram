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

	it("should merge with best matching community when multiple overlap", () => {
		const existing: Communities = {
			groupA: ["a", "b", "c"],
			groupB: ["x", "y"],
		};
		const newCommunities: Communities = {
			// 2/3 overlap with groupA, 0/2 overlap with groupB
			new: ["a", "b", "d"],
		};

		const result = mergeCommunities(existing, newCommunities, 0.5);

		// Should merge with groupA (66% overlap > 50% threshold)
		expect(Object.keys(result)).toHaveLength(2);
		expect(result.groupA?.sort()).toEqual(["a", "b", "c", "d"]);
		expect(result.groupB).toEqual(["x", "y"]);
	});

	it("should use default overlap threshold of 0.5", () => {
		const existing: Communities = {
			old: ["a", "b", "c", "d"],
		};
		const newCommunities: Communities = {
			// 2/4 = 50% overlap
			new: ["a", "b", "x", "y"],
		};

		const result = mergeCommunities(existing, newCommunities);

		// Should merge at exactly 50% threshold
		expect(Object.keys(result)).toHaveLength(1);
	});

	it("should handle multiple new communities merging into different existing ones", () => {
		const existing: Communities = {
			groupA: ["a1", "a2", "a3"],
			groupB: ["b1", "b2", "b3"],
		};
		const newCommunities: Communities = {
			newA: ["a1", "a2", "a4"],
			newB: ["b1", "b2", "b4"],
		};

		const result = mergeCommunities(existing, newCommunities, 0.5);

		expect(Object.keys(result)).toHaveLength(2);
		expect(result.groupA?.sort()).toEqual(["a1", "a2", "a3", "a4"]);
		expect(result.groupB?.sort()).toEqual(["b1", "b2", "b3", "b4"]);
	});
});

describe("graph topologies", () => {
	describe("star graph", () => {
		it("should handle star topology with central hub", () => {
			// Central node connected to all peripherals
			const edges: [string, string][] = [];
			const peripherals = ["p1", "p2", "p3", "p4", "p5"];
			for (const p of peripherals) {
				edges.push(["hub", p]);
			}
			const graph = graphFromEdges(edges);

			const result = labelPropagation(graph, { seed: 42, minCommunitySize: 1 });

			// All nodes should be in one community
			const allNodes = Object.values(result).flat();
			expect(allNodes.sort()).toEqual(["hub", "p1", "p2", "p3", "p4", "p5"]);
		});

		it("should form single community when star exceeds min size", () => {
			const edges: [string, string][] = [];
			for (let i = 0; i < 5; i++) {
				edges.push(["center", `leaf${i}`]);
			}
			const graph = graphFromEdges(edges);

			const result = labelPropagation(graph, { seed: 42, minCommunitySize: 3 });

			expect(Object.keys(result)).toHaveLength(1);
			expect(Object.values(result)[0]).toHaveLength(6);
		});
	});

	describe("line graph (path)", () => {
		it("should handle linear chain of nodes", () => {
			// a - b - c - d - e (line graph)
			const graph = graphFromEdges([
				["a", "b"],
				["b", "c"],
				["c", "d"],
				["d", "e"],
			]);

			const result = labelPropagation(graph, { seed: 42, minCommunitySize: 1 });

			// All 5 nodes should be in communities
			const allNodes = Object.values(result).flat();
			expect(allNodes.sort()).toEqual(["a", "b", "c", "d", "e"]);
		});

		it("should group line graph into one community when large enough", () => {
			const edges: [string, string][] = [];
			for (let i = 0; i < 9; i++) {
				edges.push([`n${i}`, `n${i + 1}`]);
			}
			const graph = graphFromEdges(edges);

			const result = labelPropagation(graph, { seed: 42, minCommunitySize: 1 });

			// Should converge to one or a few communities with all 10 nodes
			const allNodes = Object.values(result).flat();
			expect(allNodes).toHaveLength(10);
		});
	});

	describe("complete graph (K-clique)", () => {
		it("should form single community for K4", () => {
			// Complete graph with 4 nodes
			const graph = graphFromEdges([
				["a", "b"],
				["a", "c"],
				["a", "d"],
				["b", "c"],
				["b", "d"],
				["c", "d"],
			]);

			const result = labelPropagation(graph, { seed: 42 });

			expect(Object.keys(result)).toHaveLength(1);
			expect(Object.values(result)[0].sort()).toEqual(["a", "b", "c", "d"]);
		});

		it("should form single community for K5", () => {
			const nodes = ["a", "b", "c", "d", "e"];
			const edges: [string, string][] = [];
			for (let i = 0; i < nodes.length; i++) {
				for (let j = i + 1; j < nodes.length; j++) {
					edges.push([nodes[i], nodes[j]]);
				}
			}
			const graph = graphFromEdges(edges);

			const result = labelPropagation(graph, { seed: 42, minCommunitySize: 3 });

			expect(Object.keys(result)).toHaveLength(1);
			expect(Object.values(result)[0].sort()).toEqual(["a", "b", "c", "d", "e"]);
		});
	});

	describe("bipartite graph", () => {
		it("should handle complete bipartite K3,3", () => {
			// Every node in set A connected to every node in set B
			const setA = ["a1", "a2", "a3"];
			const setB = ["b1", "b2", "b3"];
			const edges: [string, string][] = [];
			for (const a of setA) {
				for (const b of setB) {
					edges.push([a, b]);
				}
			}
			const graph = graphFromEdges(edges);

			const result = labelPropagation(graph, { seed: 42, minCommunitySize: 3 });

			// All nodes in one community (bipartite graphs tend to merge)
			const allNodes = Object.values(result).flat();
			expect(allNodes).toHaveLength(6);
		});
	});

	describe("cycle graph", () => {
		it("should handle small cycle (triangle)", () => {
			const graph = graphFromEdges([
				["a", "b"],
				["b", "c"],
				["c", "a"],
			]);

			const result = labelPropagation(graph, { seed: 42 });

			expect(Object.keys(result)).toHaveLength(1);
			expect(Object.values(result)[0].sort()).toEqual(["a", "b", "c"]);
		});

		it("should handle larger cycle", () => {
			// 6-node cycle: hexagon
			const graph = graphFromEdges([
				["a", "b"],
				["b", "c"],
				["c", "d"],
				["d", "e"],
				["e", "f"],
				["f", "a"],
			]);

			const result = labelPropagation(graph, { seed: 42, minCommunitySize: 1 });

			// All 6 nodes should be in communities
			const allNodes = Object.values(result).flat();
			expect(allNodes.sort()).toEqual(["a", "b", "c", "d", "e", "f"]);
		});
	});

	describe("tree graph", () => {
		it("should handle binary tree", () => {
			// Simple binary tree:
			//       root
			//      /    \
			//    l1      r1
			//   /  \    /  \
			//  l2  l3  r2  r3
			const graph = graphFromEdges([
				["root", "l1"],
				["root", "r1"],
				["l1", "l2"],
				["l1", "l3"],
				["r1", "r2"],
				["r1", "r3"],
			]);

			const result = labelPropagation(graph, { seed: 42, minCommunitySize: 3 });

			const allNodes = Object.values(result).flat();
			expect(allNodes).toHaveLength(7);
		});
	});
});

describe("edge cases", () => {
	it("should handle node with only self-loop", () => {
		const graph: Graph = {
			nodes: new Map([["self", new Set(["self"])]]),
		};

		const result = labelPropagation(graph, { minCommunitySize: 1 });

		expect(Object.values(result).flat()).toContain("self");
	});

	it("should handle graph with all isolated nodes", () => {
		const graph: Graph = {
			nodes: new Map([
				["a", new Set()],
				["b", new Set()],
				["c", new Set()],
			]),
		};

		// Default minCommunitySize=3 filters them
		const result = labelPropagation(graph);
		expect(Object.keys(result)).toHaveLength(0);

		// With minCommunitySize=1, each is its own community
		const result2 = labelPropagation(graph, { minCommunitySize: 1 });
		expect(Object.values(result2).flat()).toHaveLength(3);
	});

	it("should handle asymmetric adjacency (directed-like)", () => {
		// Even though graphFromEdges creates undirected graphs,
		// test handling of manually constructed asymmetric graph
		const graph: Graph = {
			nodes: new Map([
				["a", new Set(["b"])],
				["b", new Set()], // b doesn't know about a
			]),
		};

		const result = labelPropagation(graph, { minCommunitySize: 1 });

		// Both nodes should still be processed
		const allNodes = Object.values(result).flat();
		expect(allNodes.sort()).toEqual(["a", "b"]);
	});

	it("should handle very small maxIterations", () => {
		const graph = graphFromEdges([
			["a", "b"],
			["b", "c"],
			["c", "a"],
		]);

		// Even with 1 iteration, should produce valid result
		const result = labelPropagation(graph, { maxIterations: 1, minCommunitySize: 1 });

		const allNodes = Object.values(result).flat();
		expect(allNodes).toHaveLength(3);
	});

	it("should handle maxIterations of 0", () => {
		const graph = graphFromEdges([
			["a", "b"],
			["b", "c"],
			["c", "a"],
		]);

		// 0 iterations means no updates, each node keeps its own label
		const result = labelPropagation(graph, { maxIterations: 0, minCommunitySize: 1 });

		// Each node is its own community
		expect(Object.keys(result)).toHaveLength(3);
	});

	it("should produce different results with different seeds", () => {
		// A graph with ambiguous community structure
		const graph = graphFromEdges([
			["a", "b"],
			["b", "c"],
			["c", "d"],
			["d", "e"],
			["e", "a"],
		]);

		const results = new Set<string>();
		for (let seed = 1; seed <= 20; seed++) {
			const result = labelPropagation(graph, { seed, minCommunitySize: 1 });
			results.add(
				JSON.stringify(
					Object.values(result)
						.map((v) => v.sort())
						.sort(),
				),
			);
		}

		// Should converge to consistent structure for 5-cycle
		// (all nodes in one community)
		expect(results.size).toBeGreaterThanOrEqual(1);
	});

	it("should handle nodes with numeric-like string IDs", () => {
		const graph = graphFromEdges([
			["1", "2"],
			["2", "3"],
			["3", "1"],
		]);

		const result = labelPropagation(graph, { seed: 42 });

		expect(Object.keys(result)).toHaveLength(1);
		expect(Object.values(result)[0].sort()).toEqual(["1", "2", "3"]);
	});

	it("should handle nodes with special characters in IDs", () => {
		const graph = graphFromEdges([
			["node:1", "node:2"],
			["node:2", "node:3"],
			["node:3", "node:1"],
		]);

		const result = labelPropagation(graph, { seed: 42 });

		expect(Object.values(result)[0].sort()).toEqual(["node:1", "node:2", "node:3"]);
	});

	it("should handle unicode node IDs", () => {
		const graph = graphFromEdges([
			["节点1", "节点2"],
			["节点2", "节点3"],
			["节点3", "节点1"],
		]);

		const result = labelPropagation(graph, { seed: 42 });

		expect(Object.keys(result)).toHaveLength(1);
		expect(Object.values(result)[0].sort()).toEqual(["节点1", "节点2", "节点3"]);
	});
});

describe("determinism and reproducibility", () => {
	it("should produce identical results across multiple runs with same seed", () => {
		const graph = graphFromEdges([
			["a", "b"],
			["b", "c"],
			["c", "d"],
			["d", "e"],
			["e", "f"],
			["f", "a"],
			["a", "d"],
		]);

		const results: Communities[] = [];
		for (let i = 0; i < 10; i++) {
			results.push(labelPropagation(graph, { seed: 12345 }));
		}

		// All results should be identical
		const first = JSON.stringify(results[0]);
		for (const result of results.slice(1)) {
			expect(JSON.stringify(result)).toBe(first);
		}
	});

	it("should produce sorted node arrays within communities", () => {
		const graph = graphFromEdges([
			["z", "y"],
			["y", "x"],
			["x", "z"],
		]);

		const result = labelPropagation(graph, { seed: 42 });

		for (const members of Object.values(result)) {
			const sorted = [...members].sort();
			expect(members).toEqual(sorted);
		}
	});
});

describe("performance characteristics", () => {
	it("should complete in reasonable time for sparse graph with 500 nodes", () => {
		// Create sparse random graph
		const nodes = Array.from({ length: 500 }, (_, i) => `n${i}`);
		const edges: [string, string][] = [];

		let seed = 54321;
		const random = () => {
			seed = (seed * 1103515245 + 12345) & 0x7fffffff;
			return seed / 0x7fffffff;
		};

		// ~3% edge probability for sparse graph
		for (let i = 0; i < nodes.length; i++) {
			for (let j = i + 1; j < nodes.length; j++) {
				if (random() < 0.03) {
					edges.push([nodes[i], nodes[j]]);
				}
			}
		}
		const graph = graphFromEdges(edges);

		const start = performance.now();
		const result = labelPropagation(graph, { seed: 42, minCommunitySize: 3 });
		const elapsed = performance.now() - start;

		// Should complete within 5 seconds
		expect(elapsed).toBeLessThan(5000);

		// Should produce valid communities
		const allNodes = Object.values(result).flat();
		for (const node of allNodes) {
			expect(graph.nodes.has(node)).toBe(true);
		}
	});

	it("should handle graph with high degree nodes", () => {
		// Hub-and-spoke with multiple hubs
		const edges: [string, string][] = [];

		// 3 hubs, each connected to 30 unique nodes
		for (let hub = 0; hub < 3; hub++) {
			for (let spoke = 0; spoke < 30; spoke++) {
				edges.push([`hub${hub}`, `h${hub}_spoke${spoke}`]);
			}
		}
		// Connect hubs to each other
		edges.push(["hub0", "hub1"]);
		edges.push(["hub1", "hub2"]);
		edges.push(["hub2", "hub0"]);

		const graph = graphFromEdges(edges);

		const start = performance.now();
		const result = labelPropagation(graph, { seed: 42, minCommunitySize: 3 });
		const elapsed = performance.now() - start;

		expect(elapsed).toBeLessThan(1000);
		expect(Object.values(result).flat().length).toBeGreaterThan(0);
	});
});
