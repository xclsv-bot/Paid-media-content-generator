import Anthropic from "@anthropic-ai/sdk";

// Construct the SDK client, resolving credentials in the SDK's standard order:
// ANTHROPIC_API_KEY → ANTHROPIC_AUTH_TOKEN → Workload Identity Federation →
// a local `ant auth login` profile. Throws if none are available.
export function createAnthropic(): Anthropic {
  return new Anthropic();
}

export const NOT_CONFIGURED =
  "AI isn't configured — set ANTHROPIC_API_KEY in the deployment, or run `ant auth login` in local dev.";

export { Anthropic };
