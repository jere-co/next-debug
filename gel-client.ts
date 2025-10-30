import { createClient } from "gel";

export { default as e } from "dbschema/edgeql-js";

export const gelClient = createClient({
	// Note: when developing locally you will need to set tls security to
	// insecure, because the development server uses self-signed certificates
	// which will cause api calls with the fetch api to fail.
	tlsSecurity: process.env.NODE_ENV === "development" ? "insecure" : undefined,
});
