import type { CreateFileTouchInput, FileTouch } from "./types";

/**
 * Repository interface for FileTouch operations.
 * FileTouch nodes track file operations within tool calls.
 */
export interface FileTouchRepository {
	/**
	 * Find a FileTouch by its ID.
	 */
	findById(id: string): Promise<FileTouch | null>;

	/**
	 * Find all FileTouches for a specific ToolCall.
	 */
	findByToolCall(toolCallId: string): Promise<FileTouch[]>;

	/**
	 * Find all FileTouches for a specific Turn.
	 */
	findByTurn(turnId: string): Promise<FileTouch[]>;

	/**
	 * Find all FileTouches for a specific Session.
	 */
	findBySession(sessionId: string): Promise<FileTouch[]>;

	/**
	 * Find all FileTouches for a specific file path across sessions.
	 */
	findByFilePath(filePath: string): Promise<FileTouch[]>;

	/**
	 * Find all FileTouches for a specific file path within a session.
	 */
	findByFilePathInSession(sessionId: string, filePath: string): Promise<FileTouch[]>;

	/**
	 * Find all FileTouches by action type within a session.
	 */
	findByAction(sessionId: string, action: string): Promise<FileTouch[]>;

	/**
	 * Create a new FileTouch node.
	 */
	create(input: CreateFileTouchInput): Promise<FileTouch>;

	/**
	 * Create multiple FileTouch nodes in batch.
	 */
	createBatch(inputs: CreateFileTouchInput[]): Promise<FileTouch[]>;

	/**
	 * Count FileTouches for a specific ToolCall.
	 */
	count(toolCallId: string): Promise<number>;

	/**
	 * Count FileTouches by action type within a session.
	 */
	countByAction(sessionId: string): Promise<Record<string, number>>;
}
