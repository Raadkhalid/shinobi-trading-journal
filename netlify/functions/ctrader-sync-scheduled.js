const {
  SpotwareClient,
  SpotwareHost,
  SpotwareOAuthClient,
  SpotwareTransport,
  SpotwareSocketAuthenticator,
  SpotwareHistory,
  SpotwareMarketData,
  SPOTWARE_VOLUME_SCALE,
  SPOTWARE_PRICE_SCALE,
  fromMoneyDigits,
} = require('ctrader-x');

const UNITS_PER_LOT = 100000; // standard forex lot size

const { supabaseAdmin } = require('./_supabaseAdmin');
const { refreshAccessToken } = require('./_ctraderToken');

// Mirrors guessSession() in TradingJournalPro.jsx so cTrader-imported trades
// get the same session labeling as manually-entered ones.
const guessSession = (hour) => {
  if (hour >= 0 && hour < 7) return 'Asia';
  if (hour >= 7 && hour < 12) return 'London';
  if (hour >= 12 && hour < 20) return 'New York';
  return 'Sydney';
};

async function syncOneAccount(conn) {
  let { access_token, refresh_token, expires_at, ctid_trader_account_id, user_id, last_deal_timestamp, id: connectionId } = conn;

  // Proactively refresh if the access token expires within a day - avoids
  // hitting a mid-sync expiry (access tokens last ~30 days, so this is rare).
  if (new Date(expires_at).getTime() - Date.now() < 24 * 60 * 60 * 1000) {
    const refreshed = await refreshAccessToken(refresh_token);
    access_token = refreshed.accessToken;
    refresh_token = refreshed.refreshToken;
    expires_at = new Date(Date.now() + refreshed.expiresIn * 1000).toISOString();
    await supabaseAdmin
      .from('broker_connections')
      .update({ access_token, refresh_token, expires_at, updated_at: new Date().toISOString() })
      .eq('id', connectionId);
  }

  const transport = new SpotwareTransport({ host: SpotwareHost.LIVE });
  await transport.connect();
  try {
    const authenticator = new SpotwareSocketAuthenticator(transport);
    await authenticator.authenticateApplication(process.env.CTRADER_CLIENT_ID, process.env.CTRADER_CLIENT_SECRET);
    await authenticator.authenticateAccount(ctid_trader_account_id, access_token);

    const oauthClient = new SpotwareOAuthClient({
      clientId: process.env.CTRADER_CLIENT_ID,
      clientSecret: process.env.CTRADER_CLIENT_SECRET,
    });

    const client = new SpotwareClient({
      transport,
      oauthClient,
      clientId: process.env.CTRADER_CLIENT_ID,
      clientSecret: process.env.CTRADER_CLIENT_SECRET,
      ctidTraderAccountId: ctid_trader_account_id,
      token: { accessToken: access_token, refreshToken: refresh_token, tokenType: 'bearer', expiresIn: 2628000 },
    });
    await client.connect();

    const history = new SpotwareHistory(client);
    const marketData = new SpotwareMarketData(client);

    // First-ever sync for this account: backfill the last 90 days. After that,
    // only fetch what's new since the last deal we saw.
    const fromTimestamp = last_deal_timestamp ? last_deal_timestamp + 1 : Date.now() - 90 * 24 * 60 * 60 * 1000;
    const toTimestamp = Date.now();

    const { deals } = await history.getDeals({ fromTimestamp, toTimestamp });
    // Only closing deals carry realized P&L (closePositionDetail) - the
    // opening deal of a position doesn't represent a completed trade yet.
    const closedDeals = (deals || []).filter((d) => d.closePositionDetail);

    if (closedDeals.length > 0) {
      const symbolCache = {};
      const rows = [];
      for (const deal of closedDeals) {
        if (!symbolCache[deal.symbolId]) {
          const sym = await marketData.symbols.findById(deal.symbolId);
          symbolCache[deal.symbolId] = sym?.symbolName || `SYMBOL_${deal.symbolId}`;
        }
        const symbolName = symbolCache[deal.symbolId];
        const cpd = deal.closePositionDetail;
        // getDeals() returns raw wire values - none of this is pre-converted, so both
        // the money scale (moneyDigits, which varies per-response) and the fixed price
        // scale have to be applied here, not assumed already-applied.
        const toMoney = (v) => fromMoneyDigits(v || 0, cpd.moneyDigits);
        const profit = toMoney(cpd.grossProfit) + toMoney(cpd.swap) + toMoney(cpd.commission);
        const entryPrice = (cpd.entryPrice ?? deal.executionPrice ?? 0) / SPOTWARE_PRICE_SCALE;
        const closedAtMs = deal.executionTimestamp;
        const closedAt = new Date(closedAtMs).toISOString();

        rows.push({
          user_id,
          date: closedAt.split('T')[0],
          pair: symbolName.toUpperCase().replace(/[^A-Z0-9]/g, ''),
          direction: deal.tradeSide === 'SELL' ? 'sell' : 'buy',
          entry: entryPrice,
          sl: null,
          tp: null,
          lot_size: (deal.filledVolume || deal.volume || 0) / SPOTWARE_VOLUME_SCALE / UNITS_PER_LOT,
          risk: 2,
          outcome: profit > 0 ? 'win' : profit < 0 ? 'loss' : null,
          profit,
          session: guessSession(new Date(closedAtMs).getUTCHours()),
          pre_notes: '',
          post_notes: '',
          emotion: 'Neutral',
          rules_followed: true,
          opened_at: null,
          closed_at: closedAt,
          tags: [],
          broker_deal_id: String(deal.dealId),
          source: 'ctrader',
        });
      }

      const { error: insertError } = await supabaseAdmin
        .from('trades')
        .upsert(rows, { onConflict: 'user_id,broker_deal_id', ignoreDuplicates: true });
      if (insertError) console.error(`Insert error for user ${user_id}:`, insertError);
    }

    const maxTimestamp = closedDeals.length > 0
      ? Math.max(...closedDeals.map((d) => d.executionTimestamp))
      : last_deal_timestamp || toTimestamp;

    await supabaseAdmin
      .from('broker_connections')
      .update({ last_synced_at: new Date().toISOString(), last_deal_timestamp: maxTimestamp })
      .eq('id', connectionId);
  } finally {
    await transport.disconnect?.();
  }
}

exports.handler = async () => {
  const { data: connections, error } = await supabaseAdmin
    .from('broker_connections')
    .select('*')
    .eq('broker', 'ctrader');

  if (error) {
    console.error('Failed to load broker connections:', error);
    return { statusCode: 500, body: 'Failed to load connections' };
  }

  for (const conn of connections || []) {
    try {
      await syncOneAccount(conn);
    } catch (err) {
      // One user's sync failing (expired refresh token, closed account, etc.)
      // shouldn't block everyone else's.
      console.error(`cTrader sync failed for user ${conn.user_id}:`, err);
    }
  }

  return { statusCode: 200, body: `Synced ${(connections || []).length} connection(s)` };
};
