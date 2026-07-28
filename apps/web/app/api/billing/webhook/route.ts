import { billing } from "@/lib/billing";

// Webhooks must run on Node, not the edge: signature verification needs the RAW
// body, and provider SDKs use node crypto. Pinning it now means the runtime
// isn't the thing that breaks on the day a real provider is wired up.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  return billing.handleWebhook(req);
}
