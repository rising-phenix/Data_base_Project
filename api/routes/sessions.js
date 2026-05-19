const express = require("express");
const { getCollection } = require("../db");
const { resolveClientIp, resolveLocation } = require("../geo");

const router = express.Router();

function getApiKey(req) {
  return (
    req.header("X-API-Key") ||
    req.query.apiKey ||
    ""
  );
}

function requireWriteKey(req, res, next) {
  const expected = process.env.API_KEY || "";
  if (!expected) return next();
  if (getApiKey(req) !== expected) {
    return res.status(401).json({ error: "Invalid API key" });
  }
  next();
}

function requireReadKey(req, res, next) {
  const readKey = process.env.ADMIN_API_KEY || process.env.API_KEY || "";
  if (!readKey) return next();
  const key = getApiKey(req);
  if (key !== readKey && key !== (process.env.API_KEY || "")) {
    return res.status(401).json({ error: "Invalid API key" });
  }
  next();
}

router.post("/", requireWriteKey, async (req, res) => {
  try {
    const collection = await getCollection();
    const body = req.body || {};
    const sessionId = body.sessionId;
    if (!sessionId) {
      return res.status(400).json({ error: "sessionId is required" });
    }

    const ip = resolveClientIp(req);
    const location = await resolveLocation(ip);
    const now = new Date();

    const doc = {
      sessionId,
      termsAcceptedAt: body.termsAcceptedAt || now.toISOString(),
      entryUrl: body.entryUrl || "",
      exitAt: body.exitAt || null,
      ip,
      location,
      device: body.device || {},
      referrer: body.referrer || "",
      scrollDepth: body.scrollDepth || 0,
      createdAt: now,
      updatedAt: now,
    };

    await collection.updateOne(
      { sessionId },
      { $set: doc },
      { upsert: true }
    );

    res.status(201).json({ ok: true, sessionId });
  } catch (err) {
    console.error("POST /api/sessions", err);
    res.status(500).json({ error: "Failed to create session" });
  }
});

router.patch("/:sessionId", requireWriteKey, async (req, res) => {
  try {
    const collection = await getCollection();
    const { sessionId } = req.params;
    const body = req.body || {};
    const now = new Date();

    const existing = await collection.findOne({ sessionId });
    if (!existing) {
      const ip = resolveClientIp(req);
      // const location = await resolveLocation(ip);
      const location = { country: "", city: "", lat: null, lon: null };
      await collection.insertOne({
        sessionId,
        termsAcceptedAt: body.termsAcceptedAt || now.toISOString(),
        entryUrl: body.entryUrl || "",
        exitAt: body.exitAt || null,
        ip,
        location,
        device: body.device || {},
        referrer: body.referrer || "",
        pages: [],
        clicks: [],
        scrollDepth: 0,
        createdAt: now,
        updatedAt: now,
      });
    }

    const update = { $set: { updatedAt: now } };

    if (body.exitAt !== undefined) update.$set.exitAt = body.exitAt;
    if (body.device) update.$set.device = body.device;
    if (body.referrer) update.$set.referrer = body.referrer;
    if (typeof body.scrollDepth === "number") {
      update.$max = { scrollDepth: body.scrollDepth };
    }

    const newPages = Array.isArray(body.pages) ? body.pages : [];
    const newClicks = Array.isArray(body.clicks) ? body.clicks : [];

    if (newPages.length) {
      update.$push = update.$push || {};
      update.$push.pages = { $each: newPages };
    }
    if (newClicks.length) {
      update.$push = update.$push || {};
      update.$push.clicks = { $each: newClicks };
    }

    await collection.updateOne({ sessionId }, update);
    res.json({ ok: true, sessionId });
  } catch (err) {
    console.error("PATCH /api/sessions/:sessionId", err);
    res.status(500).json({ error: "Failed to update session" });
  }
});

router.get("/", requireReadKey, async (req, res) => {
  try {
    const collection = await getCollection();
    const since = req.query.since;
    const filter = {};

    if (since) {
      const sinceDate = new Date(since);
      if (Number.isNaN(sinceDate.getTime())) {
        return res.status(400).json({ error: "Invalid since parameter" });
      }
      filter.updatedAt = { $gte: sinceDate };
    }

    const sessions = await collection
      .find(filter)
      .sort({ updatedAt: -1 })
      .limit(parseInt(req.query.limit || "500", 10))
      .toArray();

    res.json({ count: sessions.length, sessions });
  } catch (err) {
    console.error("GET /api/sessions", err);
    res.status(500).json({ error: "Failed to fetch sessions" });
  }
});

router.post("/:sessionId/flush", requireWriteKey, async (req, res) => {
  try {
    const collection = await getCollection();
    const { sessionId } = req.params;
    const body = req.body || {};
    const now = new Date();
    const update = { $set: { updatedAt: now } };

    if (body.exitAt) update.$set.exitAt = body.exitAt;

    const newPages = Array.isArray(body.pages) ? body.pages : [];
    const newClicks = Array.isArray(body.clicks) ? body.clicks : [];

    if (newPages.length) {
      update.$push = update.$push || {};
      update.$push.pages = { $each: newPages };
    }
    if (newClicks.length) {
      update.$push = update.$push || {};
      update.$push.clicks = { $each: newClicks };
    }
    if (typeof body.scrollDepth === "number") {
      update.$max = { scrollDepth: body.scrollDepth };
    }

    await collection.updateOne({ sessionId }, update, { upsert: true });
    res.json({ ok: true, sessionId });
  } catch (err) {
    console.error("POST flush", err);
    res.status(500).json({ error: "Failed to flush session" });
  }
});

router.get("/:sessionId", requireReadKey, async (req, res) => {
  try {
    const collection = await getCollection();
    const session = await collection.findOne({
      sessionId: req.params.sessionId,
    });
    if (!session) {
      return res.status(404).json({ error: "Session not found" });
    }
    res.json(session);
  } catch (err) {
    console.error("GET /api/sessions/:sessionId", err);
    res.status(500).json({ error: "Failed to fetch session" });
  }
});

module.exports = router;
