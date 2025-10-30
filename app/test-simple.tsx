// Test e.select() to see if it triggers the issue
import { e, gelClient } from "@/gel-client";

export const TestSimple = async () => {
	// Use e.select() to create a query
	const query = e.select(e.Post, () => ({
		id: true,
	}));

	const result = await query.run(gelClient);
	return <div>{JSON.stringify(result)}</div>;
};
