import { config } from "dotenv";

config({ quiet: true });

export function hasApiKey(): boolean {
  return Boolean(process.env.TYPESAFE_API_KEY?.trim());
}
