import { Kafka } from "kafkajs";

const kafka = new Kafka({
	clientId: "test-client",
	brokers: ["localhost:19092"],
	connectionTimeout: 30000,
	logLevel: 4, // DEBUG
});

async function main() {
	console.log("Creating consumer...");
	const consumer = kafka.consumer({ groupId: "test-group-" + Date.now() });

	console.log("Connecting...");
	await consumer.connect();
	console.log("Connected!");

	console.log("Subscribing...");
	await consumer.subscribe({ topic: "raw_events", fromBeginning: false });
	console.log("Subscribed!");

	console.log("Running...");
	await consumer.run({
		eachMessage: async ({ topic, partition, message }) => {
			const value = message.value;
			console.log(`Received: ${value ? value.toString() : "null"}`);
		},
	});
	console.log("Consumer running!");
}

main().catch(console.error);
