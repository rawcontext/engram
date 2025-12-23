import { apiError } from "@lib/api-response";
import { getSession } from "@lib/rbac";
import { createSchema, createYoga } from "graphql-yoga";
import { resolvers, typeDefs } from "./schema";

const yoga = createYoga({
	schema: createSchema({
		typeDefs,
		resolvers,
	}),
	graphqlEndpoint: "/api/graphql",
	fetchAPI: { Response },
});

async function handle(req: Request, context: Record<string, unknown>) {
	const session = await getSession();
	if (!session) {
		return apiError("User not authenticated", "UNAUTHORIZED", 401);
	}
	return yoga.handleRequest(req, context);
}

export { handle as GET, handle as POST };
