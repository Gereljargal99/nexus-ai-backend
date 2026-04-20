import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import axios from "axios";

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());

// HEALTH CHECK
app.get("/", (req, res) => {
  res.json({
    status: "NEXUS AI BACKEND ACTIVE",
    time: new Date().toISOString()
  });
});

// MAIN SIGNAL API
app.post("/api/signal", async (req, res) => {
  try {
    const { pair, tf, risk, strategy, price } = req.body;

    const prompt = `
You are a professional forex trading AI.

Generate a structured trading signal.

Pair: ${pair}
Timeframe: ${tf}
Risk: ${risk}
Strategy: ${strategy}
Current Price: ${price}

Return ONLY JSON:
{
  "direction": "BUY or SELL",
  "entry": "number",
  "tp1": "number",
  "tp2": "number",
  "tp3": "number",
  "sl": "number",
  "confidence": 0-100,
  "rr_ratio": "1:x",
  "analysis": "short professional explanation"
}
`;

    const response = await axios.post(
      "https://api.anthropic.com/v1/messages",
      {
        model: "claude-sonnet-4-20250514",
        max_tokens: 800,
        messages: [{ role: "user", content: prompt }]
      },
      {
        headers: {
          "Content-Type": "application/json",
          "x-api-key": process.env.ANTHROPIC_API_KEY,
          "anthropic-version": "2023-06-01"
        }
      }
    );

    const text = response.data.content[0].text;

    let json;
    try {
      json = JSON.parse(text);
    } catch (e) {
      return res.status(500).json({
        error: "Invalid JSON from AI",
        raw: text
      });
    }

    res.json(json);

  } catch (err) {
    res.status(500).json({
      error: "Backend error",
      message: err.message
    });
  }
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => {
  console.log("NEXUS BACKEND RUNNING ON PORT", PORT);
});
