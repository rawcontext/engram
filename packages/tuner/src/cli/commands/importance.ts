/**
 * Importance command - Get parameter importance analysis
 */

import { TunerClient } from "../../client/tuner-client.js";

interface ImportanceOptions {
	serviceUrl: string;
	format: "table" | "json";
	targetIdx?: number;
}

export async function importanceCommand(
	studyName: string,
	options: ImportanceOptions,
): Promise<void> {
	const client = new TunerClient({ baseUrl: options.serviceUrl });

	try {
		const importance = await client.getParamImportance(studyName, options.targetIdx ?? 0);

		if (options.format === "json") {
			console.log(JSON.stringify(importance, null, 2));
			return;
		}

		// Table format
		const entries = Object.entries(importance).sort((a, b) => b[1] - a[1]);

		if (entries.length === 0) {
			console.log("\nNo parameter importance data available.\n");
			console.log("Run more trials to enable importance analysis.");
			return;
		}

		const targetSuffix = options.targetIdx ? ` (target ${options.targetIdx})` : "";
		console.log(`\n📈 Parameter Importance for: ${studyName}${targetSuffix}\n`);

		// Calculate max name length for alignment
		const maxNameLen = Math.max(...entries.map(([name]) => name.length));

		// Header
		console.log(`  ${"Parameter".padEnd(maxNameLen)}  ${"Importance".padStart(12)}  Bar`);
		console.log(`  ${"-".repeat(maxNameLen)}  ${"-".repeat(12)}  ---`);

		// Find max importance for scaling
		const maxImportance = Math.max(...entries.map(([, value]) => value));

		// Rows
		for (const [param, value] of entries) {
			const pct = value.toFixed(4);
			const barWidth = Math.round((value / maxImportance) * 40);
			const bar = "█".repeat(barWidth);
			console.log(`  ${param.padEnd(maxNameLen)}  ${pct.padStart(12)}  ${bar}`);
		}

		console.log();
	} catch (error) {
		if (error instanceof Error) {
			if (error.message.includes("404")) {
				console.error(`Error: Study '${studyName}' not found`);
			} else {
				console.error("Error:", error.message);
			}
		} else {
			console.error("Error:", error);
		}
		process.exit(1);
	}
}
