import type { McpServer, RegisteredTool } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { SessionInstrumenter } from "./services/session-instrumenter";

// Handler type that accepts args and extra
type ToolHandler = (args: Record<string, unknown>, extra: unknown) => Promise<unknown>;

/**
 * Wraps an McpServer to instrument tool calls.
 *
 * When tools are registered through this wrapper, their calls are automatically
 * recorded to FalkorDB as ToolCall nodes linked to the current Session.
 */
export function createInstrumentedServer(
	server: McpServer,
	instrumenter: SessionInstrumenter | null,
	getWorkingDir: () => string | undefined,
): McpServer {
	// If no instrumenter, return the original server
	if (!instrumenter) {
		return server;
	}

	// Store the original registerTool method
	const originalRegisterTool = server.registerTool.bind(server);

	// Create instrumented registerTool
	const instrumentedRegisterTool = <TInput, TOutput>(
		name: string,
		config: {
			title?: string;
			description?: string;
			inputSchema?: TInput;
			outputSchema?: TOutput;
		},
		handler: ToolHandler,
	): RegisteredTool => {
		// Create wrapped handler that records tool calls
		const wrappedHandler: ToolHandler = async (args, extra) => {
			const argumentsJson = JSON.stringify(args);

			// Record the tool call as pending
			let toolCallId: string | undefined;
			try {
				// Ensure session is created with working dir context
				await instrumenter.getSessionId(getWorkingDir());
				toolCallId = await instrumenter.recordToolCall({
					toolName: name,
					argumentsJson,
					status: "pending",
				});
			} catch (error) {
				// Don't fail the tool call if instrumentation fails
				// Log to stderr since stdout is reserved for MCP protocol
				console.error("[instrumentation] Failed to record tool call:", error);
			}

			try {
				// Execute the actual handler
				const result = await handler(args, extra);

				// Update status to success
				if (toolCallId) {
					try {
						await instrumenter.updateToolCallStatus(toolCallId, "success");
					} catch (error) {
						console.error("[instrumentation] Failed to update tool status:", error);
					}
				}

				return result;
			} catch (error) {
				// Update status to error
				if (toolCallId) {
					try {
						const errorMessage = error instanceof Error ? error.message : String(error);
						await instrumenter.updateToolCallStatus(toolCallId, "error", errorMessage);
					} catch (updateError) {
						console.error("[instrumentation] Failed to update tool error status:", updateError);
					}
				}
				throw error;
			}
		};

		// Call original with wrapped handler, using type assertion to bypass complex MCP types
		return (originalRegisterTool as Function)(name, config, wrappedHandler) as RegisteredTool;
	};

	// Replace registerTool method
	(server as { registerTool: typeof instrumentedRegisterTool }).registerTool =
		instrumentedRegisterTool;

	return server;
}
