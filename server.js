const express = require('express');
const fetch = require('node-fetch');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

const TOP_N = 50;
const CONCURRENCY = 10;
const CACHE_MS = 45 * 1000;

const cache = {
  spot: { data: null, timestamp: 0 },
  swap: { data: null, timestamp: 0 }
};

app.use(express.static(path.join(__dirname, 'public')));

async function mapPool(items, concurrency, fn) {
  const results = new Array(items.length);
  let i = 0;
  async function worker() {
    while (i < items.length) {
      const idx = i++;
      try {
        results[idx] = await fn(items[idx], idx);
      } catch {
        results[idx] = items[idx];
      }
    }
  }
  await Promise.all(Array(Math.min(concurrency, items.length)).fill().map(worker));
  return results;
}

function withTimeout(promise, ms = 6000) {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), ms))
  ]);
}

// ===== SPOT =====
async function getSpotChange(symbol, lastPrice, interval) {
  const res = await withTimeout(
    fetch(`https://open-api.bingx.com/openApi/spot/v1/market/kline?symbol=${encodeURIComponent(symbol)}&interval=${interval}&limit=2`)
  );
  const json = await res.json();
  if (json.code !== 0 || !json.data?.length) return null;
  const open = parseFloat(json.data[0][1]);
  if (!open) return null;
  return ((parseFloat(lastPrice) - open) / open) * 100;
}

async function fetchSpotTickers() {
  const res = await withTimeout(
    fetch('https://open-api.bingx.com/openApi/spot/v1/ticker/24hr'),
    10000
  );
  const json = await res.json();
  if (json.code !== 0 || !Array.isArray(json.data)) throw new Error('BingX Spot ticker error');

  return json.data
    .filter(t => t.symbol.endsWith('-USDT') && parseFloat(t.quoteVolume) > 0)
    .sort((a, b) => parseFloat(b.quoteVolume) - parseFloat(a.quoteVolume))
    .slice(0, TOP_N)
    .map(t => ({
      symbol: t.symbol,
      lastPrice: t.lastPrice,
      quoteVolume: parseFloat(t.quoteVolume),
      change1h: null,
      change4h: null,
      change24h: t.priceChangePercent
        ? parseFloat(String(t.priceChangePercent).replace('%', ''))
        : null
    }));
}

async function enrichSpot(list) {
  return mapPool(list, CONCURRENCY, async (t) => {
    try {
      const [change1h, change4h] = await Promise.all([
        getSpotChange(t.symbol, t.lastPrice, '1h').catch(() => null),
        getSpotChange(t.symbol, t.lastPrice, '4h').catch(() => null)
      ]);
      return { ...t, change1h, change4h };
    } catch {
      return t;
    }
  });
}

// ===== SWAP / PERPETUAL =====
async function getSwapChange(symbol, lastPrice, interval) {
  const res = await withTimeout(
    fetch(`https://open-api.bingx.com/openApi/swap/v3/quote/klines?symbol=${encodeURIComponent(symbol)}&interval=${interval}&limit=2`)
  );
  const json = await res.json();
  if (json.code !== 0 || !json.data?.length) return null;
  const open = parseFloat(json.data[0].open);
  if (!open) return null;
  return ((parseFloat(lastPrice) - open) / open) * 100;
}

async function fetchSwapTickers() {
  const res = await withTimeout(
    fetch('https://open-api.bingx.com/openApi/swap/v2/quote/ticker'),
    10000
  );
  const json = await res.json();
  if (json.code !== 0 || !Array.isArray(json.data)) throw new Error('BingX Swap ticker error');

  return json.data
    .filter(t => t.symbol.endsWith('-USDT') && parseFloat(t.quoteVolume) > 0)
    .sort((a, b) => parseFloat(b.quoteVolume) - parseFloat(a.quoteVolume))
    .slice(0, TOP_N)
    .map(t => ({
      symbol: t.symbol,
      lastPrice: t.lastPrice,
      quoteVolume: parseFloat(t.quoteVolume),
      change1h: null,
      change4h: null,
      change24h: t.priceChangePercent != null
        ? parseFloat(String(t.priceChangePercent).replace('%', ''))
        : null
    }));
}

async function enrichSwap(list) {
  return mapPool(list, CONCURRENCY, async (t) => {
    try {
      const [change1h, change4h] = await Promise.all([
        getSwapChange(t.symbol, t.lastPrice, '1h').catch(() => null),
        getSwapChange(t.symbol, t.lastPrice, '4h').catch(() => null)
      ]);
      return { ...t, change1h, change4h };
    } catch {
      return t;
    }
  });
}

// Solo tickers (rápido)
app.get('/api/top', async (req, res) => {
  try {
    const market = (req.query.market || 'spot').toLowerCase();
    if (market !== 'spot' && market !== 'swap') {
      return res.status(400).json({ ok: false, error: 'market debe ser spot o swap' });
    }

    const c = cache[market];
    if (c.data && Date.now() - c.timestamp < CACHE_MS) {
      return res.json({ ok: true, cached: true, market, data: c.data, enriched: true });
    }

    const data = market === 'spot' ? await fetchSpotTickers() : await fetchSwapTickers();
    res.json({ ok: true, cached: false, market, data, enriched: false });
  } catch (err) {
    console.error(err);
    res.status(500).json({ ok: false, error: err.message });
  }
});

// Completar 1h y 4h
app.get('/api/enrich', async (req, res) => {
  try {
    const market = (req.query.market || 'spot').toLowerCase();
    if (market !== 'spot' && market !== 'swap') {
      return res.status(400).json({ ok: false, error: 'market debe ser spot o swap' });
    }

    const c = cache[market];
    if (c.data && Date.now() - c.timestamp < CACHE_MS) {
      return res.json({ ok: true, cached: true, market, data: c.data });
    }

    const base = market === 'spot' ? await fetchSpotTickers() : await fetchSwapTickers();
    const data = market === 'spot' ? await enrichSpot(base) : await enrichSwap(base);

    cache[market] = { data, timestamp: Date.now() };
    res.json({ ok: true, cached: false, market, data });
  } catch (err) {
    console.error(err);
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.listen(PORT, () => {
  console.log(`Servidor en http://localhost:${PORT}`);
});
