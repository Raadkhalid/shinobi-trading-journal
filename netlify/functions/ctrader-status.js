const { supabaseAdmin, getUserIdFromRequest } = require('./_supabaseAdmin');

exports.handler = async (event) => {
  const userId = await getUserIdFromRequest(event);
  if (!userId) return { statusCode: 401, body: JSON.stringify({ error: 'Not authenticated' }) };

  const { data, error } = await supabaseAdmin
    .from('broker_connections')
    .select('ctid_trader_account_id, last_synced_at, created_at')
    .eq('user_id', userId)
    .eq('broker', 'ctrader')
    .maybeSingle();

  if (error) {
    console.error('ctrader-status error:', error);
    return { statusCode: 500, body: JSON.stringify({ error: 'Lookup failed' }) };
  }

  if (!data) {
    return { statusCode: 200, body: JSON.stringify({ connected: false }) };
  }

  return {
    statusCode: 200,
    body: JSON.stringify({
      connected: true,
      ctidTraderAccountId: data.ctid_trader_account_id,
      lastSyncedAt: data.last_synced_at,
      connectedAt: data.created_at,
    }),
  };
};
