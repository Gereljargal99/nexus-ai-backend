'use strict';

require('dotenv').config();
const express    = require('express');
const cors       = require('cors');
const rateLimit  = require('express-rate-limit');
const path       = require('path');

const app  = express();
const PORT = process.env.PORT || 3000;

// ─────────────────────────────────────────
// ENV VALIDATION
// ─────────────────────────────────────────
const REQUIRED_ENV = ['TWELVEDATA_API_KEY', 'ANTHROPIC_API_KEY'];
REQUIRED_ENV.forEach(key => {
  if (!process.env[key]) {
    console.error(`[BOOT] FATAL: Missing environment variable: ${key}`);
    process.exit(1);
  }
});

const TWELVEDATA_KEY = process.env.TWELVEDATA_API_KEY;
const ANTHROPIC_KEY  = process.env.ANTHROPIC_API_KEY;

// ─────────────────────────────────────────
// MIDDLEWARE
// ─────────────────────────────────────────
app.use(cors());
app.use(express.json({ limit: '10kb' }));
app.use(express.static(path.join(__dirname, 'public')));

// Rate limiters
const priceLimiter = rateLimit({
  windowMs: 10 * 1000,       // 10 seconds
  max: 30,                    // 30 price requests per 10s (generous for ticker polling)
  standardHeaders: true,
  message: { error: 'Too many price requests. Slow down.' }
});

const signalLimiter = rateLimit({
  windowMs: 60 * 1000,       // 1 minute
  max: 10,                    // max 10 signals/minute per IP
  standardHeaders: true,
  message: { error: 'Signal rate limit reached. Wait 1 minute.' }
});

// Request logger
app.use((req, res, next) => {
  if (req.path.startsWith('/api')) {
    console.log(`[${new Date().toISOString()}] ${req.method} ${req.path}`);
  }
  next();
});

// ─────────────────────────────────────────
// PRICE CACHE (5-second TTL per symbol)
// ─────────────────────────────────────────
const priceCache = new Map();
const CACHE_TTL  = 5000; // 5 seconds

function getCached(symbol) {
  const entry = priceCache.get(symbol);
  if (!entry) return null;
  if (Date.now() - entry.timestamp > CACHE_TTL) { priceCache.delete(symbol); return null; }
  return entry.price;
}
function setCache(symbol, price) {
  priceCache.set(symbol, { price, timestamp: Date.now() });
}

// ─────────────────────────────────────────
// TWELVEDATA HELPERS
// ─────────────────────────────────────────
const TD_BASE = 'https://api.twelvedata.com';

// Valid forex pairs + commodities for TwelveData
const SYMBOL_MAP = {
  'EUR/USD': 'EUR/USD',
  'GBP/USD': 'GBP/USD',
  'USD/JPY': 'USD/JPY',
  'USD/CHF': 'USD/CHF',
  'AUD/USD': 'AUD/USD',
  'USD/CAD': 'USD/CAD',
  'NZD/USD': 'NZD/USD',
  'EUR/GBP': 'EUR/GBP',
  'EUR/JPY': 'EUR/JPY',
  'GBP/JPY': 'GBP/JPY',
  'XAU/USD': 'XAU/USD',
  'USD/SGD': 'USD/SGD',
};

async function fetchTwelvePrice(symbol) {
  const tdSymbol = SYMBOL_MAP[symbol] || symbol;
  const url = `${TD_BASE}/price?symbol=${encodeURIComponent(tdSymbol)}&apikey=${TWELVEDATA_KEY}`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 6000);
  try {
    const res  = await fetch(url, { signal: controller.signal });
    clearTimeout(timeout);
    if (!res.ok) throw new Error(`TwelveData HTTP ${res.status}`);
    const data = await res.json();
    if (data.status === 'error') throw new Error(data.message || 'TwelveData error');
    const price = parseFloat(data.price);
    if (isNaN(price) || price <= 0) throw new Error('Invalid price from TwelveData');
    return { price, source: 'twelvedata', symbol };
  } catch (err) {
    clearTimeout(timeout);
    throw err;
  }
}

async function fetchMultiplePrices(symbols) {
  const tdSymbols = symbols.map(s => SYMBOL_MAP[s] || s).join(',');
  const url = `${TD_BASE}/price?symbol=${encodeURIComponent(tdSymbols)}&apikey=${TWELVEDATA_KEY}`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);
  try {
    const res  = await fetch(url, { signal: controller.signal });
    clearTimeout(timeout);
    if (!res.ok) throw new Error(`TwelveData HTTP ${res.status}`);
    const data = await res.json();

    const results = {};
    for (const sym of symbols) {
      const tdKey = SYMBOL_MAP[sym] || sym;
      // TwelveData returns flat object for single, nested for multiple
      const entry = data[tdKey] || data;
      const price = parseFloat(entry.price);
      if (!isNaN(price) && price > 0) {
        results[sym] = price;
        setCache(sym, price);
      }
    }
    return results;
  } catch (err) {
    clearTimeout(timeout);
    throw err;
  }
}

// ─────────────────────────────────────────
// API: GET /api/health
// ─────────────────────────────────────────
app.get('/api/health', (req, res) => {
  res.json({
    status:  'ok',
    version: '1.0.0',
    time:    new Date().toISOString(),
    uptime:  Math.floor(process.uptime()) + 's'
  });
});

// ─────────────────────────────────────────
// API: GET /api/price/:symbol
// Returns a single live price from TwelveData
// ─────────────────────────────────────────
app.get('/api/price/:symbol', priceLimiter, async (req, res) => {
  const symbol = decodeURIComponent(req.params.symbol).toUpperCase();

  if (!SYMBOL_MAP[symbol]) {
    return res.status(400).json({ error: `Unsupported symbol: ${symbol}` });
  }

  // Check cache first
  const cached = getCached(symbol);
  if (cached) {
    return res.json({ symbol, price: cached, source: 'cache' });
  }

  try {
    const data = await fetchTwelvePrice(symbol);
    setCache(symbol, data.price);
    res.json({ symbol, price: data.price, source: 'twelvedata' });
  } catch (err) {
    console.error(`[price] ${symbol} error:`, err.message);
    res.status(502).json({ error: 'Price fetch failed', detail: err.message });
  }
});

// ─────────────────────────────────────────
// API: GET /api/prices
// Returns all ticker prices in one call
// ─────────────────────────────────────────
app.get('/api/prices', priceLimiter, async (req, res) => {
  const TICKER_SYMBOLS = Object.keys(SYMBOL_MAP);

  // Check how many are cached
  const result = {};
  const toFetch = [];

  for (const sym of TICKER_SYMBOLS) {
    const cached = getCached(sym);
    if (cached) result[sym] = { price: cached, source: 'cache' };
    else toFetch.push(sym);
  }

  if (toFetch.length > 0) {
    try {
      const fresh = await fetchMultiplePrices(toFetch);
      for (const [sym, price] of Object.entries(fresh)) {
        result[sym] = { price, source: 'twelvedata' };
      }
    } catch (err) {
      console.error('[prices] bulk fetch error:', err.message);
      // Return whatever we have cached
    }
  }

  res.json({ prices: result, timestamp: new Date().toISOString() });
});

// ─────────────────────────────────────────
// API: POST /api/signal
// Body: { pair, timeframe, strategy, risk }
// ─────────────────────────────────────────
app.post('/api/signal', signalLimiter, async (req, res) => {
  const { pair, timeframe, strategy = 'Trend Following', risk = 'Moderate' } = req.body;

  // Validate input
  if (!pair || !timeframe) {
    return res.status(400).json({ error: 'pair and timeframe are required' });
  }
  if (!SYMBOL_MAP[pair]) {
    return res.status(400).json({ error: `Unsupported pair: ${pair}` });
  }

  // ── STEP 1: Get live price ──
  let livePrice, priceSource;
  const cached = getCached(pair);
  if (cached) {
    livePrice = cached;
    priceSource = 'cache';
  } else {
    try {
      const data = await fetchTwelvePrice(pair);
      livePrice   = data.price;
      priceSource = 'twelvedata';
      setCache(pair, livePrice);
    } catch (err) {
      console.error(`[signal] price fetch failed for ${pair}:`, err.message);
      return res.status(502).json({ error: 'Could not fetch live price', detail: err.message });
    }
  }

  const dec      = pair.includes('JPY') || pair === 'XAU/USD' ? 2 : 5;
  const priceStr = livePrice.toFixed(dec);
  const now      = new Date();
  const utcHour  = now.getUTCHours();
  const session  = getSession(utcHour);
  const newsRisk = getNewsRisk(pair, utcHour);

  // ── STEP 2: Build institutional prompt ──
  const prompt = buildInstitutionalPrompt({
    pair, timeframe, strategy, risk,
    priceStr, utcHour, session, newsRisk
  });

  // ── STEP 3: Call Claude API ──
  let rawSig;
  try {
    const claudeRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type':      'application/json',
        'x-api-key':         ANTHROPIC_KEY,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model:      'claude-sonnet-4-20250514',
        max_tokens: 1200,
        messages:   [{ role: 'user', content: prompt }]
      })
    });

    if (!claudeRes.ok) {
      const errText = await claudeRes.text();
      throw new Error(`Claude API ${claudeRes.status}: ${errText.slice(0, 200)}`);
    }

    const claudeData = await claudeRes.json();
    const raw = claudeData.content?.[0]?.text || '{}';
    const cleaned = raw.replace(/```json|```/g, '').trim();
    rawSig = JSON.parse(cleaned);
  } catch (err) {
    console.error('[signal] Claude error:', err.message);
    return res.status(502).json({ error: 'AI signal generation failed', detail: err.message });
  }

  // ── STEP 4: Normalize + validate signal ──
  const signal = normalizeSignal(rawSig, { pair, timeframe, strategy, priceStr, dec, priceSource, newsRisk, session });

  // Sanity check: all prices must be near the live price
  validatePriceSanity(signal, livePrice, pair);

  res.json({
    ok:        true,
    signal,
    meta: {
      pair,
      timeframe,
      livePrice,
      priceSource,
      session,
      newsRisk,
      generatedAt: now.toISOString(),
      utcTime: `${String(utcHour).padStart(2,'0')}:${String(now.getUTCMinutes()).padStart(2,'0')} UTC`
    }
  });
});

// ─────────────────────────────────────────
// SIGNAL UTILITIES
// ─────────────────────────────────────────
function getSession(hour) {
  if (hour >= 0  && hour < 7)  return 'ASIAN';
  if (hour >= 7  && hour < 9)  return 'LONDON OPEN';
  if (hour >= 8  && hour < 13) return 'LONDON';
  if (hour >= 13 && hour < 17) return 'NY OVERLAP';
  if (hour >= 17 && hour < 22) return 'NEW YORK';
  return 'OFF-HOURS';
}

function getNewsRisk(pair, hour) {
  const HIGH_HOURS = [8, 9, 13, 14, 15, 16];
  const USD_PAIRS  = ['EUR/USD','GBP/USD','USD/JPY','USD/CHF','AUD/USD','USD/CAD','NZD/USD','XAU/USD'];
  const isNewsTime = HIGH_HOURS.includes(hour) || HIGH_HOURS.includes(hour + 1);
  const isUSD      = USD_PAIRS.includes(pair);
  if (isNewsTime && isUSD) return 'HIGH';
  if (isNewsTime)           return 'MODERATE';
  return 'LOW';
}

function buildInstitutionalPrompt({ pair, timeframe, strategy, risk, priceStr, utcHour, session, newsRisk }) {
  return `You are a professional institutional Forex trading analyst.

Your task is to generate a high-probability trading signal based on the given input.

Analyze the market using:
- Market structure (trend, HH/HL or LH/LL)
- Support and resistance zones
- Liquidity concepts (stop hunts, order blocks, fair value gaps)
- RSI divergence and momentum
- Risk-to-reward ratio (minimum 1:2)

CRITICAL PRICE CONSTRAINT:
The current LIVE market price for ${pair} is EXACTLY ${priceStr}.
ALL prices in your response (entry, stop_loss, take_profit) MUST be mathematically close to ${priceStr}.
DO NOT use any price from training data. Violating this makes the signal worthless.

Input:
- Pair:      ${pair}
- Timeframe: ${timeframe}
- Strategy:  ${strategy}
- Risk:      ${risk}
- Session:   ${session} (UTC ${utcHour}:00)
- NewsRisk:  ${newsRisk}

Return ONLY valid JSON. No text before or after. No markdown fences.

{
  "pair":           "${pair}",
  "direction":      "BUY",
  "entry":          ${priceStr},
  "stop_loss":      0.00000,
  "take_profit":    0.00000,
  "take_profit_2":  0.00000,
  "take_profit_3":  0.00000,
  "risk_reward":    "1:2",
  "confidence":     75,
  "analysis":       "3-4 sentence institutional analysis covering structure, liquidity, key level, entry rationale.",
  "grade":          "B",
  "grade_reason":   "One sentence.",
  "pattern":        "e.g. Order Block Retest",
  "structure":      "HH/HL",
  "key_level":      "${priceStr}",
  "session_quality":"Good",
  "spread_est":     1.2,
  "indicators":     ["RSI Bullish Divergence", "EMA 21 Support", "MACD Cross"],
  "mtf": {
    "M15": "BUY",
    "M30": "BUY",
    "H1":  "BUY",
    "H4":  "NEUTRAL",
    "D1":  "NEUTRAL"
  },
  "mtf_strength": {
    "M15": "strong",
    "M30": "moderate",
    "H1":  "strong",
    "H4":  "weak",
    "D1":  "weak"
  },
  "confluence_score":      "3/5 timeframes aligned",
  "partial_tp_strategy":   "Close 33% at TP1, 33% at TP2, trail final third to TP3 with SL moved to entry after TP1 hit."
}

Rules:
- No extra text outside JSON
- stop_loss, take_profit, take_profit_2, take_profit_3 must be real numbers (not strings, not 0)
- All price values must be within realistic distance of ${priceStr}
- Confidence 0-100, be honest
- Minimum R:R 1:2`;
}

function normalizeSignal(raw, { pair, timeframe, strategy, priceStr, dec, priceSource, newsRisk, session }) {
  const pipSize = pair.includes('JPY') ? 0.01 : pair === 'XAU/USD' ? 1.0 : 0.0001;
  const entryN  = parseFloat(raw.entry)         || parseFloat(priceStr);
  const slN     = parseFloat(raw.stop_loss)      || 0;
  const tp1N    = parseFloat(raw.take_profit)    || 0;
  const tp2N    = parseFloat(raw.take_profit_2)  || 0;
  const tp3N    = parseFloat(raw.take_profit_3)  || 0;

  return {
    // Institutional core fields (as returned)
    pair:           raw.pair         || pair,
    direction:      raw.direction    || 'BUY',
    entry:          entryN.toFixed(dec),
    stop_loss:      slN  ? slN.toFixed(dec)  : null,
    take_profit:    tp1N ? tp1N.toFixed(dec) : null,
    take_profit_2:  tp2N ? tp2N.toFixed(dec) : null,
    take_profit_3:  tp3N ? tp3N.toFixed(dec) : null,
    risk_reward:    raw.risk_reward  || '1:2',
    confidence:     Math.min(100, Math.max(0, parseInt(raw.confidence) || 70)),
    analysis:       raw.analysis     || '',

    // Extended fields
    grade:           raw.grade          || 'B',
    grade_reason:    raw.grade_reason   || '',
    pattern:         raw.pattern        || '',
    structure:       raw.structure      || '',
    key_level:       raw.key_level      || '',
    session_quality: raw.session_quality || 'Moderate',
    spread_est:      parseFloat(raw.spread_est) || (pair === 'XAU/USD' ? 0.3 : 1.2),
    indicators:      Array.isArray(raw.indicators) ? raw.indicators : [],
    mtf:             raw.mtf            || {},
    mtf_strength:    raw.mtf_strength   || {},
    confluence_score: raw.confluence_score || '',
    partial_tp_strategy: raw.partial_tp_strategy || '',

    // Computed pip distances (server-side, reliable)
    sl_pips:   slN  ? +(Math.abs(entryN - slN)  / pipSize).toFixed(1) : null,
    tp1_pips:  tp1N ? +(Math.abs(tp1N - entryN) / pipSize).toFixed(1) : null,
    tp2_pips:  tp2N ? +(Math.abs(tp2N - entryN) / pipSize).toFixed(1) : null,
    tp3_pips:  tp3N ? +(Math.abs(tp3N - entryN) / pipSize).toFixed(1) : null,

    // Metadata
    priceSource,
    newsRisk,
    session,
    timeframe,
    strategy,
  };
}

function validatePriceSanity(signal, livePrice, pair) {
  // Max allowed deviation from live price (percentage)
  const MAX_DEV = pair === 'XAU/USD' ? 0.05 : 0.005; // 5% for gold, 0.5% for forex
  const check = (label, val) => {
    if (!val) return;
    const n = parseFloat(val);
    const dev = Math.abs(n - livePrice) / livePrice;
    if (dev > MAX_DEV) {
      console.warn(`[sanity] ${label} ${val} is ${(dev*100).toFixed(2)}% away from live ${livePrice} — may be stale`);
    }
  };
  check('entry',       signal.entry);
  check('stop_loss',   signal.stop_loss);
  check('take_profit', signal.take_profit);
}

// ─────────────────────────────────────────
// FALLBACK — serve index.html for all other routes
// ─────────────────────────────────────────
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ─────────────────────────────────────────
// ERROR HANDLER
// ─────────────────────────────────────────
app.use((err, req, res, next) => {
  console.error('[error]', err.message);
  res.status(500).json({ error: 'Internal server error' });
});

// ─────────────────────────────────────────
// START
// ─────────────────────────────────────────
const server = app.listen(PORT, () => {
  console.log(`
╔══════════════════════════════════════════╗
║   NEXUS FOREX — Production Server        ║
║   Port    : ${PORT.toString().padEnd(28)}║
║   Node    : ${process.version.padEnd(28)}║
╚══════════════════════════════════════════╝`);
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('[server] SIGTERM received — shutting down gracefully');
  server.close(() => {
    console.log('[server] Closed');
    process.exit(0);
  });
});
    
