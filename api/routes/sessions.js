const express = require("express");
const { getCollection } = require("../db");
const { resolveClientIp, resolveLocation } = require("../geo");
const UAParser = require("ua-parser-js");

const router = express.Router();

/* ---------------- API KEY HELPERS ---------------- */

function getApiKey(req) {
  return req.header("X-API-Key") || req.query.apiKey || "";
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

/* ---------------- UA PARSER HELPER ---------------- */

function parseBrowser(req, bodyDevice = {}) {
  const ua = bodyDevice.userAgent || req.headers["user-agent"] || "";
  const parser = new UAParser(ua);
  const result = parser.getResult();

  return {
    userAgent: ua,
    browser: result.browser.name || "",
    browserVersion: result.browser.version || "",
    os: result.os.name || "",
    osVersion: result.os.version || "",
    deviceType: result.device.type || "desktop",
    deviceVendor: result.device.vendor || "",
    deviceModel: result.device.model || "",
    screen: bodyDevice.screen || "",
    language: bodyDevice.language || "",
    timezone: bodyDevice.timezone || "",
  };
}

/* ---------------- SESSION CREATE ---------------- */

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

    const parsedDevice = parseBrowser(req, body.device);

    const doc = {
      sessionId,
      visitorId: body.visitorId || req.cookies?.visitorId || `visitor_${sessionId}`,
      termsAcceptedAt: body.termsAcceptedAt || now.toISOString(),
      entryUrl: body.entryUrl || "",
      exitAt: body.exitAt || null,
      exitUrl: body.exitUrl || "",
      ip,
      location,
      device: parsedDevice,
      browser: parsedDevice.browser,
      os: parsedDevice.os,
      referrer: body.referrer || "",
      scrollDepth: body.scrollDepth || 0,
      totalSessionDurationMs: body.totalSessionDurationMs || 0,
      isBounce: body.isBounce || false,
      pages: [],
      clicks: [],
      comments: [],
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

/* ---------------- SESSION PATCH ---------------- */

router.patch("/:sessionId", requireWriteKey, async (req, res) => {
  try {
    const collection = await getCollection();
    const { sessionId } = req.params;
    const body = req.body || {};
    const now = new Date();

    const parsedDevice = body.device ? parseBrowser(req, body.device) : null;

    const update = {
      $set: { updatedAt: now }
    };

    if (body.exitAt !== undefined) update.$set.exitAt = body.exitAt;
    if (body.referrer) update.$set.referrer = body.referrer;

    if (parsedDevice) {
      update.$set.device = parsedDevice;
      update.$set.browser = parsedDevice.browser;
      update.$set.os = parsedDevice.os;
    }

    if (body.exitUrl !== undefined) update.$set.exitUrl = body.exitUrl;

    if (typeof body.totalSessionDurationMs === "number")
      update.$set.totalSessionDurationMs = body.totalSessionDurationMs;

    if (typeof body.isBounce === "boolean")
      update.$set.isBounce = body.isBounce;

    if (typeof body.scrollDepth === "number") {
      update.$max = { scrollDepth: body.scrollDepth };
    }

    // Pages: tracker sends the full array every flush, so we replace (not append).
    // This avoids duplicates from repeated periodic flushes.
    const newPages = Array.isArray(body.pages) ? body.pages : [];
    if (newPages.length) {
      update.$set.pages = newPages;
    }

    // Clicks and comments: tracker only sends new ones since last flush, so append.
    const newClicks = Array.isArray(body.clicks) ? body.clicks : [];
    const newComments = Array.isArray(body.comments) ? body.comments : [];

    if (newClicks.length) {
      update.$push = update.$push || {};
      update.$push.clicks = { $each: newClicks };
    }

    if (newComments.length) {
      update.$push = update.$push || {};
      update.$push.comments = { $each: newComments };
    }

    await collection.updateOne({ sessionId }, update, { upsert: true });

    res.json({ ok: true, sessionId });
  } catch (err) {
    console.error("PATCH /api/sessions/:sessionId", err);
    res.status(500).json({ error: "Failed to update session" });
  }
});

/* ---------------- SESSION FLUSH (beacon on exit) ---------------- */

router.post("/:sessionId/flush", requireWriteKey, async (req, res) => {
  try {
    const collection = await getCollection();
    const { sessionId } = req.params;
    const body = req.body || {};
    const now = new Date();

    const update = {
      $set: { updatedAt: now }
    };

    if (body.exitAt) update.$set.exitAt = body.exitAt;
    if (body.exitUrl !== undefined) update.$set.exitUrl = body.exitUrl;

    if (typeof body.totalSessionDurationMs === "number")
      update.$set.totalSessionDurationMs = body.totalSessionDurationMs;

    if (typeof body.isBounce === "boolean")
      update.$set.isBounce = body.isBounce;

    if (typeof body.scrollDepth === "number") {
      update.$max = { scrollDepth: body.scrollDepth };
    }

    // Same as PATCH: pages are a full replacement, clicks/comments are appended.
    const newPages = Array.isArray(body.pages) ? body.pages : [];
    if (newPages.length) {
      update.$set.pages = newPages;
    }

    const newClicks = Array.isArray(body.clicks) ? body.clicks : [];
    const newComments = Array.isArray(body.comments) ? body.comments : [];

    if (newClicks.length) {
      update.$push = update.$push || {};
      update.$push.clicks = { $each: newClicks };
    }

    if (newComments.length) {
      update.$push = update.$push || {};
      update.$push.comments = { $each: newComments };
    }

    await collection.updateOne({ sessionId }, update, { upsert: true });

    res.json({ ok: true, sessionId });
  } catch (err) {
    console.error("POST flush", err);
    res.status(500).json({ error: "Failed to flush session" });
  }
});

/* ---------------- GET ALL SESSIONS ---------------- */

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

/* ---------------- GET ONE SESSION ---------------- */

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