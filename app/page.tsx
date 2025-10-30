import { Suspense } from "react";
import { getPosts } from "./server";

const HomeAsync = async () => {
	const posts = await getPosts();
	return (
		<div>
			<pre>
				<code>{JSON.stringify(posts, null, 2)}</code>
			</pre>
		</div>
	);
};

export default function Home() {
	return (
		<div>
			<Suspense fallback={<div>Loading...</div>}>
				<HomeAsync />
			</Suspense>
		</div>
	);
}
