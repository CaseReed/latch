import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { config } from "dotenv";

config({ quiet: true });
config({ path: join(dirname(fileURLToPath(import.meta.url)), "../.env"), quiet: true });

export function hasApiKey(): boolean {
  return Boolean(process.env.TYPESAFE_API_KEY?.trim());
}
