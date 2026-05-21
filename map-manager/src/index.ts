import { createApp } from "./app.js";
import { config } from "./config.js";
import { ensureDataLayout } from "./services/manifest-store.js";

async function main() {
  await ensureDataLayout();
  const app = createApp();

  app.listen(config.port, () => {
    console.log(`Management service listening on http://localhost:${config.port}`);
  });
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
