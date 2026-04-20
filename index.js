const express = require("express");
const cors = require("cors");
require("dotenv").config();

const app = express();

// ======================
// MIDDLEWARE
// ======================
app.use(cors());
app.use(express.json());

// Optional: request logger (useful in production)
app.use((req, res, next) => {
  console.log(`${req.method} ${req.url}`);
  next();
});

// ======================
// HEALTH CHECK ROUTE
// ======================
app.get("/", (req, res) => {
  res.status(200).json({
    status: "success",
    message: "NEXUS AI BACKEND RUNNING 🚀",
    time: new Date().toISOString()
  });
});

// ======================
// MAIN API ROUTE (CHAT)
// ======================
app.post("/api/chat", async (req, res) => {
  try {
    const { message } = req.body;

    // validation
    if (!message || message.trim() === "") {
      return res.status(400).json({
        status: "error",
        message: "Message is required"
      });
    }

    // ======================
    // SIMPLE AI LOGIC (PLACEHOLDER)
    // Later you can connect OpenAI here
    // ======================
    const reply = generateBasicResponse(message);

    return res.status(200).json({
      status: "success",
      input: message,
      reply: reply
    });

  } catch (error) {
    console.error("Chat error:", error);

    return res.status(500).json({
      status: "error",
      message: "Internal server error"
    });
  }
});

// ======================
// SIMPLE AI FUNCTION (TEMP)
// ======================
function generateBasicResponse(text) {
  const lower = text.toLowerCase();

  if (lower.includes("hello") || lower.includes("hi")) {
    return "Hello 👋 How can I help you today?";
  }

  if (lower.includes("who are you")) {
    return "I am NEXUS AI, your assistant system.";
  }

  if (lower.includes("help")) {
    return "Sure — tell me what you need help with.";
  }

  return "I understood: " + text;
}

// ======================
// 404 HANDLER
// ======================
app.use((req, res) => {
  res.status(404).json({
    status: "error",
    message: "Route not found"
  });
});

// ======================
// SERVER START
// ======================
const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
});
