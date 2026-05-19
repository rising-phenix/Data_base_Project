require("dotenv").config();

const express = require("express");
const cors = require("cors");
const { connectDb } = require("./db");
const sessionsRouter = require("./routes/sessions");

const app = express();
const PORT = process.env.PORT || 3000;

const allowedOrigins = (
  process.env.CORS_ORIGINS ||
  "https://rising-phenix.github.io,http://localhost:5500,http://127.0.0.1:5500"
)
  .split(",")
  .map((o) => o.trim())
  .filter(Boolean);

app.use(
  cors({
    origin(origin, callback) {
      if (!origin || allowedOrigins.includes(origin)) {
        callback(null, true);
      } else {
        callback(new Error("Not allowed by CORS"));
      }
    },
  })
);

app.use(express.json({ limit: "1mb" }));

app.get("/health", (_req, res) => {
  res.json({ ok: true });
});

app.use("/api/sessions", sessionsRouter);

app.use((err, _req, res, _next) => {
  if (err.message === "Not allowed by CORS") {
    return res.status(403).json({ error: "CORS blocked" });
  }
  console.error(err);
  res.status(500).json({ error: "Internal server error" });
});

(async () => {
  try {
    await connectDb();
    console.log("MongoDB connected");
  } catch (err) {
    console.error("MongoDB failed but server will still start:", err.message);
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Tracker API listening on port ${PORT}`);
  });
})();
