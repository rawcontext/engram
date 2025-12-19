import type { Logger } from "@engram/logger";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

export interface ElicitationResult<T = Record<string, unknown>> {
	accepted: boolean;
	content?: T;
}

export interface ConfirmationOptions {
	title?: string;
	confirmLabel?: string;
	cancelLabel?: string;
}

export interface SelectionOption {
	value: string;
	label: string;
	description?: string;
}

/**
 * Wrapper for MCP elicitation capability.
 * Elicitation allows the server to request user input mid-operation.
 * Only available when client has elicitation capability.
 */
export class ElicitationService {
	private server: McpServer;
	private logger: Logger;
	private _enabled = false;

	constructor(server: McpServer, logger: Logger) {
		this.server = server;
		this.logger = logger;
	}

	/**
	 * Enable elicitation after capability negotiation confirms client support
	 */
	enable(): void {
		this._enabled = true;
		this.logger.info("Elicitation capability enabled");
	}

	/**
	 * Check if elicitation is available
	 */
	get enabled(): boolean {
		return this._enabled;
	}

	/**
	 * Request confirmation from the user
	 */
	async confirm(
		message: string,
		options: ConfirmationOptions = {},
	): Promise<ElicitationResult<{ confirmed: boolean }>> {
		if (!this._enabled) {
			this.logger.debug("Elicitation not available, returning default rejection");
			return { accepted: false };
		}

		try {
			const result = await this.server.server.elicitInput({
				message,
				requestedSchema: {
					type: "object",
					properties: {
						confirmed: {
							type: "boolean",
							title: options.title ?? "Confirm",
							description: message,
						},
					},
					required: ["confirmed"],
				},
			});

			if (result.action === "accept") {
				return {
					accepted: true,
					content: { confirmed: Boolean(result.content?.confirmed) },
				};
			}

			return { accepted: false };
		} catch (error) {
			this.logger.warn({ error }, "Elicitation request failed");
			return { accepted: false };
		}
	}

	/**
	 * Request user to select from options
	 */
	async select<T extends string>(
		message: string,
		options: SelectionOption[],
	): Promise<ElicitationResult<{ selected: T }>> {
		if (!this._enabled) {
			this.logger.debug("Elicitation not available, returning default rejection");
			return { accepted: false };
		}

		try {
			const result = await this.server.server.elicitInput({
				message,
				requestedSchema: {
					type: "object",
					properties: {
						selected: {
							type: "string",
							title: "Selection",
							enum: options.map((o) => o.value),
							enumNames: options.map((o) => o.label),
						},
					},
					required: ["selected"],
				},
			});

			if (result.action === "accept" && result.content?.selected) {
				return {
					accepted: true,
					content: { selected: result.content.selected as T },
				};
			}

			return { accepted: false };
		} catch (error) {
			this.logger.warn({ error }, "Elicitation request failed");
			return { accepted: false };
		}
	}

	/**
	 * Request text input from user
	 */
	async promptText(
		message: string,
		options: { title?: string; placeholder?: string; required?: boolean } = {},
	): Promise<ElicitationResult<{ text: string }>> {
		if (!this._enabled) {
			this.logger.debug("Elicitation not available, returning default rejection");
			return { accepted: false };
		}

		try {
			const result = await this.server.server.elicitInput({
				message,
				requestedSchema: {
					type: "object",
					properties: {
						text: {
							type: "string",
							title: options.title ?? "Input",
							description: options.placeholder,
						},
					},
					required: options.required !== false ? ["text"] : [],
				},
			});

			if (result.action === "accept") {
				return {
					accepted: true,
					content: { text: String(result.content?.text ?? "") },
				};
			}

			return { accepted: false };
		} catch (error) {
			this.logger.warn({ error }, "Elicitation request failed");
			return { accepted: false };
		}
	}

	/**
	 * Request selection from multiple memories (for disambiguation)
	 */
	async selectMemory(
		message: string,
		memories: Array<{ id: string; preview: string; type: string }>,
	): Promise<ElicitationResult<{ selectedId: string }>> {
		if (!this._enabled) {
			return { accepted: false };
		}

		const options = memories.map((m) => ({
			value: m.id,
			label: `${m.type}: ${m.preview.slice(0, 50)}...`,
			description: m.preview,
		}));

		const result = await this.select<string>(message, options);

		if (result.accepted && result.content) {
			return {
				accepted: true,
				content: { selectedId: result.content.selected },
			};
		}

		return { accepted: false };
	}

	/**
	 * Confirm a potentially destructive action
	 */
	async confirmDestructive(
		action: string,
		details: string,
	): Promise<ElicitationResult<{ confirmed: boolean; understood: boolean }>> {
		if (!this._enabled) {
			return { accepted: false };
		}

		try {
			const result = await this.server.server.elicitInput({
				message: `⚠️ ${action}\n\n${details}`,
				requestedSchema: {
					type: "object",
					properties: {
						confirmed: {
							type: "boolean",
							title: "I want to proceed",
							description: "Confirm you want to perform this action",
						},
						understood: {
							type: "boolean",
							title: "I understand this cannot be undone",
							description: "Acknowledge that this action is irreversible",
						},
					},
					required: ["confirmed", "understood"],
				},
			});

			if (result.action === "accept") {
				return {
					accepted: true,
					content: {
						confirmed: Boolean(result.content?.confirmed),
						understood: Boolean(result.content?.understood),
					},
				};
			}

			return { accepted: false };
		} catch (error) {
			this.logger.warn({ error }, "Elicitation request failed");
			return { accepted: false };
		}
	}
}
