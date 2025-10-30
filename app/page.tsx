import { Suspense } from "react";
import { TestSimple } from "./test-simple";

export default function Home() {
	return (
		<div>
			<Suspense fallback={<div>Loading...</div>}>
				<TestSimple />
			</Suspense>
		</div>
	);
}
