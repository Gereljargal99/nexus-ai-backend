const express = require("express");
const cors = require("cors");
require("dotenv").config();

const OpenAI = require("openai");

const app = express();

app.use(cors());
app.use(express.json());

// ======================
// OPENAI CONFIG
// ======================
const client = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// ======================
// HEALTH CHECK
// ======================
app.get("/", (req, res) => {
  res.json({
    status: "ok",
    message: "NEXUS AI BACKEND + OPENAI RUNNING 🚀",
  });
});

// ======================
// AI CHAT ROUTE
// ======================
app.post("/api/chat", async (req, res) => {
  try {
    const { message } = req.body;

    if (!message) {
      return res.status(400).json({
        error: "Message is required",
      });
    }

    // ======================
    // OPENAI REQUEST
    // ======================
    const response = await client.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        {
          role: "system",
          content: "You are NEXUS AI, a helpful assistant.",
        },
        {
          role: "user",
          content: message,
        },
      ],
    });

    const aiReply = response.choices[0].message.content;

    res.json({
      input: message,
      reply: aiReply,
    });

  } catch (error) {
    console.error("OpenAI Error:", error);

    res.status(500).json({
      error: "AI request failed",
    });
  }
});

// ======================
// START SERVER
// ======================
const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log("Server running on port", PORT);
});
