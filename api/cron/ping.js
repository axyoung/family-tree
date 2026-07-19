// Vercel Cron hits this route on the schedule defined in vercel.json.
// It calls a trivial, no-auth Supabase RPC purely to register activity and
// prevent the free-tier project from auto-pausing after inactivity.
// Reads no real data and requires no secrets beyond the same publishable
// key already shipped in the client bundle.
export default async function handler(req, res) {
  const supabaseUrl = process.env.VITE_SUPABASE_URL;
  const supabaseAnonKey = process.env.VITE_SUPABASE_ANON_KEY;

  if (!supabaseUrl || !supabaseAnonKey) {
    res.status(500).json({ ok: false, error: "Missing Supabase env vars in Vercel project settings." });
    return;
  }

  try {
    const response = await fetch(`${supabaseUrl}/rest/v1/rpc/keepalive_ping`, {
      method: "POST",
      headers: {
        apikey: supabaseAnonKey,
        Authorization: `Bearer ${supabaseAnonKey}`,
        "Content-Type": "application/json",
      },
      body: "{}",
    });

    if (!response.ok) {
      const text = await response.text();
      res.status(502).json({ ok: false, error: `Supabase responded ${response.status}: ${text}` });
      return;
    }

    res.status(200).json({ ok: true, pingedAt: new Date().toISOString() });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
}
