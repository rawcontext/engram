/**
 * Best command - Get best parameters from a study
 */

import { writeFileSync } from "node:fs";
import { TunerClient } from "../../client/tuner-client.js";

interface BestOptions {
	serviceUrl: string;
	export?: string;
	format: "table" | "json" | "env";
}

/**
 * Convert parameter name to environment variable format
 * e.g., "search.minScore.dense" -> "SEARCH_MIN_SCORE_DENSE"
 */
function paramToEnvVar(param: string): string {
	return param
		.replace(/\./g, "_")
		.replace(/([a-z])([A-Z])/g, "$1_$2")
		.toUpperCase();
}

export async function bestCommand(studyName: string, options: BestOptions): Promise<void> {
	const client = new TunerClient({ baseUrl: options.serviceUrl });

	try {
		const best = await client.getBestParams(studyName);

		switch (options.format) {
			case "json":
				console.log(JSON.stringify(best, null, 2));
				break;

			case "env": {
				const lines: string[] = [
					`# Best parameters from study: ${studyName}`,
					`# Trial ID: ${best.trial_id}`,
					`# Value: ${JSON.stringify(best.value)}`,
					"",
				];

				for (const [key, value] of Object.entries(best.params)) {
					const envVar = paramToEnvVar(key);
					lines.push(`${envVar}=${value}`);
				}

				const content = lines.join("\n");
				console.log(content);

				if (options.export) {
					writeFileSync(options.export, `${content}\n`);
					console.log(`\nExported to: ${options.export}`);
				}
				break;
			}
			default: {
				console.log(`\n🏆 Best Parameters for: ${studyName}\n`);
				console.log(`  Trial ID: ${best.trial_id}`);
				console.log(`  Value:    ${JSON.stringify(best.value)}`);
				console.log("\n  Parameters:");

				const maxKeyLen = Math.max(...Object.keys(best.params).map((k) => k.length));

				for (const [key, value] of Object.entries(best.params)) {
					console.log(`    ${key.padEnd(maxKeyLen)}  ${value}`);
				}

				console.log();

				if (options.export) {
					// Also export to file in table mode if requested
					const lines: string[] = [
						`# Best parameters from study: ${studyName}`,
						`# Trial ID: ${best.trial_id}`,
						`# Value: ${JSON.stringify(best.value)}`,
						"",
					];

					for (const [key, value] of Object.entries(best.params)) {
						const envVar = paramToEnvVar(key);
						lines.push(`${envVar}=${value}`);
					}

					writeFileSync(options.export, `${lines.join("\n")}\n`);
					console.log(`Exported to: ${options.export}`);
				}
				break;
			}
		}
	} catch (error) {
		if (error instanceof Error) {
			if (error.message.includes("404")) {
				console.error(`Error: Study '${studyName}' not found or no completed trials`);
			} else {
				console.error("Error:", error.message);
			}
		} else {
			console.error("Error:", error);
		}
		process.exit(1);
	}
}
