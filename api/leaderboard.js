// Vercel Serverless Function using Upstash Redis REST API
export default async function handler(req, res) {
  // CORS (optional; keep if frontend and API are on different domains)
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const base = process.env.UPSTASH_REDIS_REST_URL;      // e.g. https://us1-...upstash.io
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;   // Bearer token
  if (!base || !token) return res.status(500).json({ error: 'Upstash not configured' });

  const KEY = 'leaderboard:v1';

  async function r(path) {
    const resp = await fetch(`${base}/${path}`, { headers: { Authorization: `Bearer ${token}` } });
    const data = await resp.json();
    if (data.error) throw new Error(data.error);
    return data.result;
  }

  try {
    if (req.method === 'GET') {
      const limit = Math.min(parseInt(req.query.limit || '20', 10), 100);
      const arr = await r(`zrevrange/${KEY}/0/${limit - 1}/withscores`);
      const lb = [];
      for (let i = 0; i < arr.length; i += 2) lb.push({ name: arr[i], score: Number(arr[i + 1]) });
      return res.status(200).json({ lb });
    }

    if (req.method === 'POST') {
      const { name, score } = req.body || {};
      const clean = String((name || '').slice(0, 20)).trim();
      const sc = Math.max(0, Math.min(1_000_000, Math.floor(Number(score) || 0)));
      if (!clean) return res.status(400).json({ error: 'name required' });

      // Update only if higher than existing
      const existing = await r(`zscore/${KEY}/${encodeURIComponent(clean)}`);
      if (existing === null || sc > Number(existing)) {
        await r(`zadd/${KEY}/${sc}/${encodeURIComponent(clean)}`);
      }

      // Trim to top 100 to keep things snappy
      await r(`zremrangebyrank/${KEY}/100/-1`);

      // Rank (0-based -> 1-based)
      const rank0 = await r(`zrevrank/${KEY}/${encodeURIComponent(clean)}`);

      // Return top 20
      const arr = await r(`zrevrange/${KEY}/0/19/withscores`);
      const lb = [];
      for (let i = 0; i < arr.length; i += 2) lb.push({ name: arr[i], score: Number(arr[i + 1]) });

      return res.status(200).json({ rank: rank0 == null ? null : Number(rank0) + 1, lb });
    }

    return res.status(405).json({ error: 'Method not allowed' });
  } catch (err) {
    return res.status(500).json({ error: err.message || 'server error' });
  }
}
