import { validateDataset } from "../../longmemeval/loader.js";

export async function validateCommand(path: string): Promise<void> {
	console.log(`🔍 Validating dataset: ${path}`);
	console.log("");

	const result = await validateDataset(path);

	if (result.valid) {
		console.log("✅ Dataset is valid");
		console.log("");
		console.log("Statistics:");
		console.log(`  Total instances: ${result.stats?.totalInstances}`);
		console.log(`  Total sessions: ${result.stats?.totalSessions}`);
		console.log(`  Total turns: ${result.stats?.totalTurns}`);
		console.log(`  Abstention questions: ${result.stats?.abstentionCount}`);
		console.log("");
		console.log("By Memory Ability:");
		for (const [ability, count] of Object.entries(result.stats?.byAbility ?? {})) {
			console.log(`  ${ability}: ${count}`);
		}
	} else {
		console.error("❌ Dataset validation failed");
		console.error("");
		console.error(`Error: ${result.error}`);
		process.exit(1);
	}
}
