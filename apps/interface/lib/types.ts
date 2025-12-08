export interface GraphNode {
	id: string;
	label: string;
	[key: string]: unknown;
}

export interface GraphLink {
	source: string;
	target: string;
	type: string;
	properties?: Record<string, unknown>;
}

export interface LineageResponse {
	nodes: GraphNode[];
	links: GraphLink[];
}

export interface TimelineEvent {
	id: string;
	[key: string]: unknown;
}

export interface ReplayResponse {
	timeline: TimelineEvent[];
}
