export interface GraphNode {
	id: string;
	label: string;
	[key: string]: any;
}

export interface GraphLink {
	source: string;
	target: string;
	type: string;
	properties?: Record<string, any>;
}

export interface LineageResponse {
	nodes: GraphNode[];
	links: GraphLink[];
}

export interface TimelineEvent {
	id: string;
	// biome-ignore lint/suspicious/noExplicitAny: Dynamic payload
	[key: string]: any;
}

export interface ReplayResponse {
	timeline: TimelineEvent[];
}
