const express = require("express");
const cors = require("cors");

const app = express();

app.use(cors());
app.use(express.json());

app.get("/", (req, res) => {
  res.json({
    status: "ok",
    message: "NEXUS AI BACKEND RUNNING 🚀"
  });
});

app.post("/api/chat", (req, res) => {
  const message = req.body.message;

  if (!message) {
    return res.status(400).json({ error: "message required" });
  }

  return res.json({
    reply: "You said: " + message
  });
});

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log("Server running on port", PORT);
});
