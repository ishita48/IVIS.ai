import dotenv from "dotenv";
import path from "path";
import { ensureElasticIndex, ensureElasticSystemIndices } from "./elastic";

dotenv.config({ path: path.resolve(process.cwd(), ".env.local") });
dotenv.config({ path: path.resolve(process.cwd(), ".env") });

async function main() {
  if (!process.env.ELASTIC_URL) {
    throw new Error("ELASTIC_URL is missing from apps/lens/.env.local");
  }
  await ensureElasticIndex();
  await ensureElasticSystemIndices();
  console.log(`Elastic index ready: ${process.env.ELASTIC_INDEX || "lens-sources"}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});