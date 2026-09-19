import "dotenv/config";
import { ensureElasticIndex } from "./elastic";

async function main() {
  if (!process.env.ELASTIC_URL) {
    throw new Error("ELASTIC_URL is missing from apps/lens/.env.local");
  }
  await ensureElasticIndex();
  console.log(`Elastic index ready: ${process.env.ELASTIC_INDEX || "lens-sources"}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});