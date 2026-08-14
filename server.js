const express = require('express');
const fetch = require('node-fetch');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

const TICKER_URL = 'https://open-api.bingx.com/openApi/spot/v1/ticker/24hr';
const KLINE_URL  = 'https://open-api.bingx.com/openApi/spot/v1/market/kline';
const TOP_N = 50;
const CONCURRENCY = 8;

// Cache simple (60 segundos)
let cache = { data: null, timestamp: 0 };
const CACHE_MS = 60 * 1000;

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

async function get4hChange(symbol, lastPrice) {
  try {
    const res = await fetch(`${KLINE_URL}?symbol=${symbol}&interval=4h&limit=2`);
    const json = await res.json();
    if (json.code !== 0 || !json.data?.length) return null;
    const open = parseFloat(json.data[0][1]);
    if (!open) return null;
    return ((parseFloat(lastPrice) - open) / open) * 100;
  } catch {
    return null;
  }
}

app.get('/api/top50', async (req, res) => {
  try {
    // Usar cache si está fresco
    if (cache.data && Date.now() - cache.timestamp < CACHE_MS) {
      return res.json({ ok: true, cached: true, data: cache.data });
    }

    const tickerRes = await fetch(TICKER_URL);
    const tickerJson = await tickerRes.json();

    if (tickerJson.code !== 0 || !Array.isArray(tickerJson.data)) {
      return res.status(502).json({ ok: false, error: 'BingX ticker error' });
    }

    const top = tickerJson.data
      .filter(t => t.symbol.endsWith('-USDT') && parseFloat(t.quoteVolume) > 0)
      .sort((a, b) => parseFloat(b.quoteVolume) - parseFloat(a.quoteVolume))
      .slice(0, TOP_N);

    const with4h = await mapPool(top, CONCURRENCY, async (t) => {
      const change4h = await get4hChange(t.symbol, t.lastPrice);
      return {
        symbol: t.symbol,
        lastPrice: t.lastPrice,
        quoteVolume: t.quoteVolume,
        change4h
      };
    });

    cache = { data: with4h, timestamp: Date.now() };
    res.json({ ok: true, cached: false, data: with4h });
  } catch (err) {
    console.error(err);
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.listen(PORT, () => {
  console.log(`Servidor corriendo en http://localhost:${PORT}`);
});
