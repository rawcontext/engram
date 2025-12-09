import { SchemaManager } from "../packages/search-core/src/services/schema-manager";

const manager = new SchemaManager();
await manager.migrateToMultiVectorSchema();
console.log("Schema migration complete!");
