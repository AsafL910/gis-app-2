import { writeFileSync } from "fs";
import { resolve } from "path";
import { fileURLToPath } from "url";
import { createOpenApiDocument } from "../docs/openapi/document.js";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const document = createOpenApiDocument();
const outputPath = resolve(__dirname, "../../openapi.json");

writeFileSync(outputPath, JSON.stringify(document, null, 2), "utf8");
console.log(`OpenAPI schema successfully written to ${outputPath}`);
