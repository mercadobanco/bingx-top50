const express = require('express');
const fetch = require('node-fetch');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

const TOP_N = 80;
const CONCURRENCY = 8;
const CACHE_MS = 60 * 1000;

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
      results[idx] = await fn(items[idx], idx);
    }
  }
  await Promise.all(Array(Math.min(concurrency, items.length)).fill().map(worker));
  return results;
}

// ===== SPOT =====
async function getSpotChange(symbol, lastPrice, interval) {
  try {
    const res = await fetch(
      `https://open-api.bingx.com/openApi/spot/v1/market/kline?symbol=${symbol}&interval=${interval}&limit=2`
    );
    const json = await res.json();
    if (json.code !== 0 || !json.data?.length) return null;
    const open = parseFloat(json.data[0][1]);
    if (!open) return null;
    return ((parseFloat(lastPrice) - open) / open) * 100;
  } catch {
    return null;
  }
}

async function fetchSpot() {
  const res = await fetch('https://open-api.bingx.com/openApi/spot/v1/ticker/24hr');
  const json = await res.json();
  if (json.code !== 0 || !Array.isArray(json.data)) throw new Error('BingX Spot ticker error');

  const top = json.data
    .filter(t => t.symbol.endsWith('-USDT') && parseFloat(t.quoteVolume) > 0)
    .sort((a, b) => parseFloat(b.quoteVolume) - parseFloat(a.quoteVolume))
    .slice(0, TOP_N);

  return mapPool(top, CONCURRENCY, async (t) => {
    const [change1h, change4h] = await Promise.all([
      getSpotChange(t.symbol, t.lastPrice, '1h'),
      getSpotChange(t.symbol, t.lastPrice, '4h')
    ]);
    let change24h = null;
    if (t.priceChangePercent) {
      change24h = parseFloat(String(t.priceChangePercent).replace('%', ''));
    }
    return {
      symbol: t.symbol,
      lastPrice: t.lastPrice,
      quoteVolume: parseFloat(t.quoteVolume),
      change1h,
      change4h,
      change24h
    };
  });
}

// ===== PERPETUAL (SWAP) =====
async function getSwapChange(symbol, lastPrice, interval) {
  try {
    const res = await fetch(
      `https://open-api.bingx.com/openApi/swap/v3/quote/klines?symbol=${symbol}&interval=${interval}&limit=2`
    );
    const json = await res.json();
    if (json.code !== 0 || !json.data?.length) return null;
    const candle = json.data[0];
    const open = parseFloat(candle.open);
    if (!open) return null;
    return ((parseFloat(lastPrice) - open) / open) * 100;
  } catch {
    return null;
  }
}

async function fetchSwap() {
  const res = await fetch('https://open-api.bingx.com/openApi/swap/v2/quote/ticker');
  const json = await res.json();
  if (json.code !== 0 || !Array.isArray(json.data)) throw new Error('BingX Swap ticker error');

  const top = json.data
    .filter(t => t.symbol.endsWith('-USDT') && parseFloat(t.quoteVolume) > 0)
    .sort((a, b) => parseFloat(b.quoteVolume) - parseFloat(a.quoteVolume))
    .slice(0, TOP_N);

  return mapPool(top, CONCURRENCY, async (t) => {
    const [change1h, change4h] = await Promise.all([
      getSwapChange(t.symbol, t.lastPrice, '1h'),
      getSwapChange(t.symbol, t.lastPrice, '4h')
    ]);
    let change24h = null;
    if (t.priceChangePercent != null) {
      change24h = parseFloat(String(t.priceChangePercent).replace('%', ''));
    }
    return {
      symbol: t.symbol,
      lastPrice: t.lastPrice,
      quoteVolume: parseFloat(t.quoteVolume),
      change1h,
      change4h,
      change24h
    };
  });
}

app.get('/api/top', async (req, res) => {
  try {
    const market = (req.query.market || 'spot').toLowerCase();
    if (market !== 'spot' && market !== 'swap') {
      return res.status(400).json({ ok: false, error: 'market debe ser spot o swap' });
    }

    const c = cache[market];
    if (c.data && Date.now() - c.timestamp < CACHE_MS) {
      return res.json({ ok: true, cached: true, market, data: c.data });
    }

    const data = market === 'spot' ? await fetchSpot() : await fetchSwap();
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
