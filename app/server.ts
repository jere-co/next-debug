import { e, gelClient } from "@/gel-client";

export const getPosts = async () => {
	const query = e.select(e.Post, () => ({
		id: true,
	}));

	const result = await query.run(gelClient);

	return result;
};
