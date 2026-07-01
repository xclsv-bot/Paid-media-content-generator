// Fetch JSON without exploding on non-JSON responses. A serverless timeout or a
// platform error page returns HTML/text (e.g. "An error occurred…"), and calling
// res.json() on that throws "Unexpected token …". This reads the body defensively
// and always yields a usable { error } message.
export async function fetchJson(
  input: string,
  init?: RequestInit,
): Promise<{ ok: boolean; status: number; data: Record<string, unknown> }> {
  const res = await fetch(input, init);
  const text = await res.text().catch(() => "");
  let data: Record<string, unknown> = {};
  try {
    const parsed = text ? JSON.parse(text) : {};
    if (parsed && typeof parsed === "object") data = parsed as Record<string, unknown>;
  } catch {
    // Non-JSON body — leave data empty and synthesize an error below.
  }
  if (data.error == null && !res.ok) {
    data.error =
      res.status === 504 || res.status === 408 || res.status === 502
        ? "That took too long and timed out. Try again — a shorter note usually helps."
        : `Request failed (${res.status}). Please try again.`;
  }
  return { ok: res.ok, status: res.status, data };
}
