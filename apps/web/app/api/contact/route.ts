export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// No mail provider is connected. Returning 202 with an explicit body is more
// honest than a silent 200 that looks like the message was delivered.
export async function POST(req: Request) {
  const form = await req.formData();
  const email = String(form.get("email") ?? "");
  const message = String(form.get("message") ?? "");
  if (!email || !message) {
    return Response.json({ ok: false, error: "Email and message are required." }, { status: 400 });
  }
  console.log("[contact] would send:", { email, length: message.length });
  return Response.json(
    { ok: true, delivered: false, note: "No mail provider connected yet." },
    { status: 202 },
  );
}
