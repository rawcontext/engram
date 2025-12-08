// Test the updated KafkaClient with Node.js runtime
import { createKafkaClient } from "../packages/storage/src/kafka";

async function main() {
	console.log("Creating Kafka client...");
	const kafka = createKafkaClient("test-client");

	console.log("Creating consumer...");
	const consumer = await kafka.createConsumer("node-test-group-" + Date.now());
	console.log("Consumer created!");

	console.log("Subscribing to raw_events...");
	await consumer.subscribe({ topic: "raw_events", fromBeginning: false });
	console.log("Subscribed!");

	console.log("Running consumer...");
	consumer.run({
		eachMessage: async ({ topic, partition, message }) => {
			console.log({
				topic,
				partition,
				offset: message.offset,
				key: message.key?.toString(),
				value: message.value.toString(),
			});
		},
	});

	console.log("Consumer is running! Waiting for messages (30s)...");

	// Keep alive
	await new Promise((resolve) => setTimeout(resolve, 30000));

	console.log("Disconnecting...");
	await consumer.disconnect();
	console.log("Done!");
}

main().catch((err) => {
	console.error("Error:", err);
	process.exit(1);
});
