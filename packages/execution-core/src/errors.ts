export type ExecutionErrorType = 'UserError' | 'SystemError';

export interface ExecutionError {
  type: ExecutionErrorType;
  message: string;
  details?: any;
}

export const isUserError = (err: any): boolean => {
    // Logic to distinguish syntax/runtime errors from sandbox crashes
    return true; // Default
};
