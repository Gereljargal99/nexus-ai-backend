import express from "express";
import fetch from "node-fetch";
import cors from "cors";

const app = express();
app.use(cors());
app.use(express.json());

const API_KEY = process.env.TWELVE_DATA_KEY;

/* =========================
   INDICATORS (IMPROVED)
========================= */

function ema(data, period) {
  let k = 2 / (period + 1);
  let arr = [data[0]];

  for (let i = 1; i < data.length; i++) {
    arr.push(data[i] * k + arr[i - 1] * (1 - k));
  }

  return arr;
}

/* FIXED RSI (REAL VERSION) */
function rsi(data) {
  let gains = 0;
  let losses = 0;

  for (let i = 1; i < data.length; i++) {
    let diff = data[i] - data[i - 1];

    if (diff > 0) gains += diff;
    else losses += Math.abs(diff);
  }

  let rs = gains / (losses || 1);
  return 100 - (100 / (1 + rs));
}

/* =========================
   SIGNAL ENGINE
========================= */

app.post("/signal", async (req, res) => {
  const { pair } = req.body;

  try {
    const url = `https://api.twelvedata.com/time_series?symbol=${pair}&interval=5min&outputsize=80&apikey=${API_KEY}`;

    const r = await fetch(url);
    const data = await r.json();

    if (!data.values) {
      return res.json({ error: "no data" });
    }

    let closes = data.values
      .reverse()
      .map(x => parseFloat(x.close));

    let e9 = ema(closes, 9);
    let e21 = ema(closes, 21);

    let last = closes.length - 1;

    let rsiVal = rsi(closes.slice(-14));
    let trend = e9[last] - e21[last];

    let signal = "WAIT";
    let confidence = 50;

    /* =========================
       LOGIC ENGINE (IMPROVED)
    ========================= */

    if (trend > 0 && rsiVal > 55) {
      signal = "BUY";
      confidence = 60 + Math.min(rsiVal - 50, 30);
    }

    if (trend < 0 && rsiVal < 45) {
      signal = "SELL";
      confidence = 60 + Math.min(50 - rsiVal, 30);
    }

    res.json({
      pair,
      signal,
      rsi: Number(rsiVal.toFixed(2)),
      trend: Number(trend.toFixed(6)),
      confidence: Number(confidence.toFixed(1))
    });

  } catch (err) {
    res.status(500).json({ error: "server error" });
  }
});

/* =========================
   LIVE PRICES (FIX GOLD ISSUE)
========================= */

app.get("/prices", async (req, res) => {
  try {
    const symbols = "EUR/USD,GBP/USD,USD/JPY,XAU/USD,BTC/USD";

    const url = `https://api.twelvedata.com/price?symbol=${symbols}&apikey=${API_KEY}`;

    const r = await fetch(url);
    const data = await r.json();

    res.json({
      EURUSD: data["EUR/USD"],
      GBPUSD: data["GBP/USD"],
      USDJPY: data["USD/JPY"],
      XAUUSD: data["XAU/USD"],
      BTCUSD: data["BTC/USD"]
    });

  } catch (err) {
    res.status(500).json({ error: "price feed failed" });
  }
});

/* =========================
   HEALTH CHECK
========================= */

app.get("/", (req, res) => {
  res.send("NEXUS AI BACKEND RUNNING");
});

/* =========================
   START SERVER
========================= */

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log("NEXUS AI backend running on port", PORT);
});
