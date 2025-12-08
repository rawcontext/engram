// Test script for @confluentinc/kafka-javascript with Bun runtime
// This library uses native librdkafka instead of pure JS, which should work better with Bun

const { Kafka } = require("@confluentinc/kafka-javascript").KafkaJS;

async function main() {
	console.log("Creating Kafka instance...");
	const kafka = new Kafka({});

	console.log("Creating consumer...");
	const consumer = kafka.consumer({
		"bootstrap.servers": "localhost:19092",
		"group.id": "confluent-test-group-" + Date.now(),
		"auto.offset.reset": "earliest",
		"enable.auto.commit": true,
	});

	console.log("Connecting...");
	await consumer.connect();
	console.log("Connected!");

	console.log("Subscribing to raw_events...");
	await consumer.subscribe({ topics: ["raw_events"] });
	console.log("Subscribed!");

	console.log("Running consumer...");
	consumer.run({
		eachMessage: async ({
			topic,
			partition,
			message,
		}: {
			topic: string;
			partition: number;
			message: { offset: string; key?: Buffer; value: Buffer };
		}) => {
			console.log({
				topic,
				partition,
				offset: message.offset,
				key: message.key?.toString(),
				value: message.value.toString(),
			});
		},
	});

	console.log("Consumer is running! Waiting for messages...");

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
