/**
 * Label Propagation Algorithm (LPA) for Community Detection
 *
 * Implements asynchronous label propagation for finding communities in graphs.
 * Each node starts with a unique label and iteratively adopts the most common
 * label among its neighbors until convergence.
 *
 * Time complexity: O(E) per iteration where E is the number of edges
 * Space complexity: O(V) where V is the number of vertices
 *
 * References:
 * - Wikipedia: https://en.wikipedia.org/wiki/Label_propagation_algorithm
 * - NetworkX: https://github.com/networkx/networkx/blob/main/networkx/algorithms/community/label_propagation.py
 */

/**
 * Graph representation using adjacency lists
 */
export interface Graph {
	/** Map of nodeId -> set of neighbor nodeIds */
	nodes: Map<string, Set<string>>;
}

/**
 * Options for the label propagation algorithm
 */
export interface LabelPropagationOptions {
	/** Maximum iterations before stopping (default: 100) */
	maxIterations?: number;
	/** Minimum community size to keep (default: 3) */
	minCommunitySize?: number;
	/** Seed for deterministic randomization (optional) */
	seed?: number;
}

/**
 * Result of label propagation: community label -> array of node IDs
 */
export type Communities = Record<string, string[]>;

/**
 * Internal label state for a node
 */
interface NodeLabel {
	nodeId: string;
	label: string;
}

/**
 * Seeded random number generator for deterministic tie-breaking
 * Uses simple Linear Congruential Generator (LCG)
 */
class SeededRandom {
	private state: number;

	constructor(seed?: number) {
		this.state = seed ?? Date.now();
	}

	/** Generate next random number in [0, 1) */
	next(): number {
		// LCG parameters (same as glibc)
		this.state = (this.state * 1103515245 + 12345) & 0x7fffffff;
		return this.state / 0x7fffffff;
	}

	/** Shuffle array in place using Fisher-Yates */
	shuffle<T>(array: T[]): T[] {
		for (let i = array.length - 1; i > 0; i--) {
			const j = Math.floor(this.next() * (i + 1));
			[array[i], array[j]] = [array[j], array[i]];
		}
		return array;
	}

	/** Pick random element from array */
	choice<T>(array: T[]): T {
		return array[Math.floor(this.next() * array.length)];
	}
}

/**
 * Get the most frequent label among a node's neighbors
 *
 * @param nodeId - The node to update
 * @param graph - The graph
 * @param labels - Current label assignments
 * @param rng - Random number generator for tie-breaking
 * @returns The most frequent neighbor label, or current label if isolated
 */
function getMostFrequentNeighborLabel(
	nodeId: string,
	graph: Graph,
	labels: Map<string, string>,
	rng: SeededRandom,
): string {
	const neighbors = graph.nodes.get(nodeId);

	// Isolated nodes keep their label
	if (!neighbors || neighbors.size === 0) {
		return labels.get(nodeId)!;
	}

	// Count label frequencies among neighbors
	const labelCounts = new Map<string, number>();
	for (const neighbor of neighbors) {
		const neighborLabel = labels.get(neighbor)!;
		labelCounts.set(neighborLabel, (labelCounts.get(neighborLabel) || 0) + 1);
	}

	// Find maximum count
	let maxCount = 0;
	for (const count of labelCounts.values()) {
		if (count > maxCount) {
			maxCount = count;
		}
	}

	// Collect all labels with maximum count (for tie-breaking)
	const maxLabels: string[] = [];
	for (const [label, count] of labelCounts) {
		if (count === maxCount) {
			maxLabels.push(label);
		}
	}

	// Random tie-breaking
	if (maxLabels.length === 1) {
		return maxLabels[0];
	}

	return rng.choice(maxLabels);
}

/**
 * Check if algorithm has converged (no node wants to change its label)
 *
 * @param graph - The graph
 * @param labels - Current label assignments
 * @returns True if converged
 */
function hasConverged(graph: Graph, labels: Map<string, string>): boolean {
	for (const nodeId of graph.nodes.keys()) {
		const currentLabel = labels.get(nodeId)!;
		const neighbors = graph.nodes.get(nodeId);

		if (!neighbors || neighbors.size === 0) {
			continue;
		}

		// Count label frequencies among neighbors
		const labelCounts = new Map<string, number>();
		for (const neighbor of neighbors) {
			const neighborLabel = labels.get(neighbor)!;
			labelCounts.set(neighborLabel, (labelCounts.get(neighborLabel) || 0) + 1);
		}

		// Check if current label is among the most frequent
		let maxCount = 0;
		for (const count of labelCounts.values()) {
			if (count > maxCount) {
				maxCount = count;
			}
		}

		const currentCount = labelCounts.get(currentLabel) || 0;
		if (currentCount < maxCount) {
			return false;
		}
	}

	return true;
}

/**
 * Extract communities from label assignments
 *
 * @param labels - Node label assignments
 * @param minSize - Minimum community size
 * @returns Communities grouped by label
 */
function extractCommunities(labels: Map<string, string>, minSize: number): Communities {
	// Group nodes by label
	const communities = new Map<string, string[]>();
	for (const [nodeId, label] of labels) {
		if (!communities.has(label)) {
			communities.set(label, []);
		}
		communities.get(label)!.push(nodeId);
	}

	// Filter by minimum size and convert to record
	const result: Communities = {};
	for (const [label, nodes] of communities) {
		if (nodes.length >= minSize) {
			// Sort nodes for deterministic output
			result[label] = nodes.sort();
		}
	}

	return result;
}

/**
 * Perform Label Propagation Algorithm for community detection
 *
 * Implements asynchronous LPA:
 * 1. Initialize each node with a unique label
 * 2. In random order, update each node's label to the most common among neighbors
 * 3. Repeat until convergence or max iterations reached
 * 4. Filter out communities smaller than minCommunitySize
 *
 * @param graph - Input graph as adjacency list
 * @param options - Algorithm options
 * @returns Communities as { label: [nodeIds] }
 *
 * @example
 * ```typescript
 * const graph: Graph = {
 *   nodes: new Map([
 *     ["a", new Set(["b", "c"])],
 *     ["b", new Set(["a", "c"])],
 *     ["c", new Set(["a", "b"])],
 *     ["d", new Set(["e"])],
 *     ["e", new Set(["d"])],
 *   ])
 * };
 *
 * const communities = labelPropagation(graph);
 * // { "a": ["a", "b", "c"] } (d and e filtered out as too small)
 * ```
 */
export function labelPropagation(graph: Graph, options?: LabelPropagationOptions): Communities {
	const maxIterations = options?.maxIterations ?? 100;
	const minCommunitySize = options?.minCommunitySize ?? 3;
	const rng = new SeededRandom(options?.seed);

	// Handle empty graph
	if (graph.nodes.size === 0) {
		return {};
	}

	// Initialize: each node gets its own unique label (using nodeId as label)
	const labels = new Map<string, string>();
	const nodeIds = Array.from(graph.nodes.keys());
	for (const nodeId of nodeIds) {
		labels.set(nodeId, nodeId);
	}

	// Iterate until convergence or max iterations
	for (let iteration = 0; iteration < maxIterations; iteration++) {
		// Check convergence before iteration
		if (hasConverged(graph, labels)) {
			break;
		}

		// Process nodes in random order (asynchronous update)
		const shuffledNodes = rng.shuffle([...nodeIds]);

		for (const nodeId of shuffledNodes) {
			const newLabel = getMostFrequentNeighborLabel(nodeId, graph, labels, rng);
			labels.set(nodeId, newLabel);
		}
	}

	return extractCommunities(labels, minCommunitySize);
}

/**
 * Create a Graph from an edge list
 *
 * @param edges - Array of [source, target] pairs
 * @returns Graph with bidirectional edges
 *
 * @example
 * ```typescript
 * const graph = graphFromEdges([
 *   ["a", "b"],
 *   ["b", "c"],
 *   ["c", "a"]
 * ]);
 * ```
 */
export function graphFromEdges(edges: [string, string][]): Graph {
	const nodes = new Map<string, Set<string>>();

	for (const [source, target] of edges) {
		// Add source node if not exists
		if (!nodes.has(source)) {
			nodes.set(source, new Set());
		}
		// Add target node if not exists
		if (!nodes.has(target)) {
			nodes.set(target, new Set());
		}

		// Add bidirectional edges (undirected graph)
		nodes.get(source)!.add(target);
		nodes.get(target)!.add(source);
	}

	return { nodes };
}

/**
 * Get community membership for a specific node
 *
 * @param communities - Communities from labelPropagation
 * @param nodeId - Node to look up
 * @returns Community label if found, undefined otherwise
 */
export function getCommunityForNode(communities: Communities, nodeId: string): string | undefined {
	for (const [label, members] of Object.entries(communities)) {
		if (members.includes(nodeId)) {
			return label;
		}
	}
	return undefined;
}

/**
 * Merge results from incremental community detection
 *
 * When running LPA on a subset of nodes (e.g., new entities),
 * use this to merge with existing communities.
 *
 * @param existing - Existing communities
 * @param newCommunities - Newly detected communities
 * @param overlapThreshold - Minimum overlap (0-1) to merge (default: 0.5)
 * @returns Merged communities
 */
export function mergeCommunities(
	existing: Communities,
	newCommunities: Communities,
	overlapThreshold = 0.5,
): Communities {
	const result: Communities = { ...existing };
	const existingValues = Object.values(existing);

	for (const [newLabel, newMembers] of Object.entries(newCommunities)) {
		const newSet = new Set(newMembers);

		// Find best matching existing community
		let bestMatch: string | null = null;
		let bestOverlap = 0;

		for (const [existingLabel, existingMembers] of Object.entries(result)) {
			const existingSet = new Set(existingMembers);
			const intersection = new Set([...newSet].filter((x) => existingSet.has(x)));
			const overlap = intersection.size / Math.min(newSet.size, existingSet.size);

			if (overlap > bestOverlap) {
				bestOverlap = overlap;
				bestMatch = existingLabel;
			}
		}

		// Merge or create new
		if (bestMatch && bestOverlap >= overlapThreshold) {
			// Merge: add new members to existing community
			const merged = new Set([...result[bestMatch], ...newMembers]);
			result[bestMatch] = Array.from(merged).sort();
		} else {
			// New community
			result[newLabel] = newMembers.sort();
		}
	}

	return result;
}
