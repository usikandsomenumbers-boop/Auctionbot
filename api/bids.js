import { neon } from '@neondatabase/serverless';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  try {
    if (!process.env.DATABASE_URL) {
      return res.status(500).json({ error: 'DATABASE_URL is missing' });
    }

    const sql = neon(process.env.DATABASE_URL);

    if (req.method === 'GET') {
      const bids = await sql`
        SELECT user_id as "userId", username, amount, updated_at as "updatedAt"
        FROM bids
        ORDER BY amount DESC, updated_at ASC
      `;

      return res.status(200).json({
        bids,
        maxBid: bids.length ? bids[0].amount : 0,
        serverTime: Date.now()
      });
    }

    if (req.method === 'POST') {
      let body = req.body;
      if (typeof body === 'string') {
        try { body = JSON.parse(body); } catch (e) {
          return res.status(400).json({ error: 'Invalid JSON' });
        }
      }

      const userId = String(body?.userId || '').trim();
      const username = String(body?.username || 'unknown').trim();
      const amount = Math.max(0, Math.floor(Number(body?.amount) || 0));

      if (!userId) {
        return res.status(400).json({ error: 'userId is required' });
      }

      let accepted = false;
      let reason = null;

      if (amount === 0) {
        // Remove own bid
        await sql`DELETE FROM bids WHERE user_id = ${userId}`;
        accepted = true;
      } else {
        // Get current max
        const maxResult = await sql`SELECT COALESCE(MAX(amount), 0) as max FROM bids`;
        const currentMax = maxResult[0].max;

        if (amount > currentMax) {
          // Accept the bid
          await sql`
            INSERT INTO bids (user_id, username, amount, updated_at)
            VALUES (${userId}, ${username}, ${amount}, NOW())
            ON CONFLICT (user_id) DO UPDATE
            SET username = EXCLUDED.username,
                amount = EXCLUDED.amount,
                updated_at = NOW()
          `;
          accepted = true;
        } else {
          accepted = false;
          reason = 'too_low';
        }
      }

      // Always return fresh list
      const bids = await sql`
        SELECT user_id as "userId", username, amount, updated_at as "updatedAt"
        FROM bids
        ORDER BY amount DESC, updated_at ASC
      `;

      return res.status(200).json({
        accepted,
        reason,
        bids,
        maxBid: bids.length ? bids[0].amount : 0,
        serverTime: Date.now()
      });
    }

    return res.status(405).json({ error: 'Method not allowed' });
  } catch (err) {
    console.error('API Error:', err);
    return res.status(500).json({ error: 'Server error', details: err.message });
  }
}
