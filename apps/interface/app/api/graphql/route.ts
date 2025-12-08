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

const handle = (req: Request, context: Record<string, unknown>) => yoga.handleRequest(req, context);

export { handle as GET, handle as POST };
