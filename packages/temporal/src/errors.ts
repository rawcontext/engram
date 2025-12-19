export type ExecutionErrorType = "UserError" | "SystemError";

export interface ExecutionError {
	type: ExecutionErrorType;
	message: string;
	details?: unknown;
}

export const isUserError = (_err: unknown): boolean => {
	// Logic to distinguish syntax/runtime errors from sandbox crashes
	return true; // Default
};
