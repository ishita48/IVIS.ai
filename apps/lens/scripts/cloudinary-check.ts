/**
 * npm run cloudinary:check
 *
 * Validates all three Cloudinary credentials against the live API and says
 * precisely which one is wrong. The shape checks in lib/cloudinary.ts catch
 * a swapped key/secret; only a real request catches a wrong cloud_name.
 */
import { config } from "dotenv";
config({ path: ".env.local" });

async function main() {
  const { cloudinaryPing } = await import("../lib/cloudinary");
  const { ok, detail } = await cloudinaryPing();
  console.log(ok ? `✓ Cloudinary OK — ${detail}` : `✗ ${detail}`);
  process.exit(ok ? 0 : 1);
}

void main();
