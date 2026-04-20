import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import axios from "axios";

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());

// HEALTH CHECK (what you see now)
app.get("/", (req, res) => {
  res.json({ status: "NEXUS BACKEND LIVE" });
});

// MAIN AI SIGNAL ENDPOINT
app.post("/api/signal", async (req, res) => {
  try {
    const { pair, tf, risk, strategy, price } = req.body;

    const prompt = `
You are a professional forex trading AI.

PAIR: ${pair}
TF: ${tf}
RISK: ${risk}
STRATEGY: ${strategy}
PRICE: ${price}

Return ONLY JSON:
{
  "direction": "BUY or SELL",
  "entry": "",
  "tp1": "",
  "tp2": "",
  "tp3": "",
  "sl": "",
  "confidence": 0-100,
  "rr_ratio": "1:x",
  "analysis": "short explanation"
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

    const json = JSON.parse(text);

    res.json(json);

  } catch (err) {
    res.status(500).json({
      error: "AI error",
      message: err.message
    });
  }
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => {
  console.log("NEXUS BACKEND RUNNING ON", PORT);
});
