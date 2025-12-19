/**
 * API types matching the Python Pydantic models in apps/tuner
 */

// Search Space Parameters
export interface FloatParameter {
	type: "float";
	name: string;
	low: number;
	high: number;
	step?: number;
	log?: boolean;
}

export interface IntParameter {
	type: "int";
	name: string;
	low: number;
	high: number;
	step?: number;
	log?: boolean;
}

export interface CategoricalParameter {
	type: "categorical";
	name: string;
	choices: (string | number | boolean)[];
}

export type SearchSpaceParameter = FloatParameter | IntParameter | CategoricalParameter;

// Sampler and Pruner types
export type SamplerType = "tpe" | "gp" | "random" | "nsgaii" | "qmc";
export type PrunerType = "hyperband" | "median" | "none";
export type Direction = "maximize" | "minimize";

// Study types
export interface CreateStudyRequest {
	name: string;
	direction: Direction | Direction[];
	search_space: SearchSpaceParameter[];
	sampler?: SamplerType;
	pruner?: PrunerType;
	load_if_exists?: boolean;
}

export interface StudyResponse {
	study_id: number;
	study_name: string;
	direction: Direction | Direction[];
	n_trials: number;
	best_value: number | number[] | null;
	best_params: Record<string, number | string | boolean> | null;
	datetime_start: string | null;
	user_attrs: Record<string, unknown>;
}

export interface StudySummary {
	study_id: number;
	study_name: string;
	direction: Direction | Direction[];
	n_trials: number;
	best_value: number | number[] | null;
	datetime_start: string | null;
}

// Trial types
export type TrialState = "RUNNING" | "COMPLETE" | "PRUNED" | "FAIL" | "WAITING";

export interface TrialSuggestion {
	trial_id: number;
	params: Record<string, number | string | boolean>;
	study_name: string;
}

export interface TrialCompleteRequest {
	values: number | number[];
	intermediate_values?: Record<number, number>;
	user_attrs?: Record<string, unknown>;
}

export interface TrialResponse {
	trial_id: number;
	study_name: string;
	state: TrialState;
	values: number[] | null;
	params: Record<string, number | string | boolean>;
	datetime_start: string | null;
	datetime_complete: string | null;
	duration_seconds: number | null;
	user_attrs: Record<string, unknown>;
}

// Analysis types
export interface BestParamsResponse {
	params: Record<string, number | string | boolean>;
	value: number | number[];
	trial_id: number;
}

export interface ParamImportance {
	importances: Record<string, number>;
	method: string;
}

export interface ParetoTrialResponse {
	trial_id: number;
	values: number[];
	params: Record<string, number | string | boolean>;
}

// Health check
export interface HealthResponse {
	status: "healthy" | "degraded";
	version: string;
	storage_connected: boolean;
}
