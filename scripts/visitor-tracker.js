(function () {
    "use strict";

    var SESSION_ID_KEY = "visitorSessionId";
    var VISITOR_ID_KEY = "visitorId";
    var TERMS_KEY = "termsAccepted";
    var ENTRY_AT_KEY = "visitorEntryAt";

    var state = {
        started: false,
        sessionId: null,
        visitorId: null,
        entryAt: null,
        currentPage: null,
        pendingClicks: [],
        pendingPages: [],
        pendingComments: [],
        maxScrollDepth: 0,
        flushTimer: null
    };

    function config() {
        return window.TRACKER_CONFIG || {};
    }

    function apiBase() {
        var base = (config().apiBaseUrl || "").replace(/\/$/, "");
        return base;
    }

    function apiKey() {
        return config().apiKey || "";
    }

    function hasConsent() {
        return sessionStorage.getItem(TERMS_KEY) === "true";
    }

    function isHomePage() {
        var path = window.location.pathname;
        var file = path.split("/").pop() || "";
        return file === "" || file === "index.html" || /\/Data_base_Project\/?$/i.test(path);
    }

    function isDeclinedPage() {
        return /sorryaccessdeclined\.html$/i.test(window.location.pathname);
    }

    function homeUrl() {
        var path = window.location.pathname;
        if (path.indexOf("/blogs/") !== -1 || path.indexOf("/category/") !== -1) {
            return "../index.html";
        }
        return "index.html";
    }

    function termsUrl() {
        var path = window.location.pathname;
        if (path.indexOf("/blogs/") !== -1 || path.indexOf("/category/") !== -1) {
            return "../termsandconditions.html";
        }
        return "termsandconditions.html";
    }

    function getOrCreateSessionId() {
        var id = sessionStorage.getItem(SESSION_ID_KEY);
        if (!id) {
            id = typeof crypto !== "undefined" && crypto.randomUUID
                ? crypto.randomUUID()
                : "sess-" + Date.now() + "-" + Math.random().toString(36).slice(2, 11);
            sessionStorage.setItem(SESSION_ID_KEY, id);
        }
        return id;
    }

    // Persists across sessions in localStorage so the same physical visitor
    // is recognised on future visits (unlike sessionId which resets each tab).
    function getOrCreateVisitorId() {
        var id;
        try {
            id = localStorage.getItem(VISITOR_ID_KEY);
            if (!id) {
                id = typeof crypto !== "undefined" && crypto.randomUUID
                    ? crypto.randomUUID()
                    : "visitor-" + Date.now() + "-" + Math.random().toString(36).slice(2, 11);
                localStorage.setItem(VISITOR_ID_KEY, id);
            }
        } catch (e) {
            // localStorage blocked (private browsing etc.) — fall back to session-scoped id
            id = "visitor-" + getOrCreateSessionId();
        }
        return id;
    }

    function deviceInfo() {
        return {
            userAgent: navigator.userAgent,
            screen: screen.width + "x" + screen.height,
            language: navigator.language || "",
            timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || ""
        };
    }

    function nowIso() {
        return new Date().toISOString();
    }

    function clickLabel(el) {
        if (!el) return "";
        var text = (el.innerText || el.textContent || "").trim();
        if (text.length > 80) text = text.slice(0, 80) + "...";
        return text;
    }

    function totalSessionDurationMs() {
        if (!state.entryAt) return 0;
        return Date.now() - new Date(state.entryAt).getTime();
    }

    // A bounce is a session where the visitor viewed only one page.
    function isBounce() {
        var allPages = state.pendingPages.concat(state.currentPage ? [state.currentPage] : []);
        var uniquePaths = {};
        allPages.forEach(function (p) { if (p && p.path) uniquePaths[p.path] = true; });
        return Object.keys(uniquePaths).length <= 1;
    }

    function buildPayload(extra) {
        var payload = {
            sessionId: state.sessionId,
            visitorId: state.visitorId,
            termsAcceptedAt: state.entryAt,
            entryUrl: sessionStorage.getItem("visitorEntryUrl") || window.location.href,
            device: deviceInfo(),
            referrer: document.referrer || "",
            pages: state.pendingPages.slice(),
            clicks: state.pendingClicks.slice(),
            comments: state.pendingComments.slice(),
            scrollDepth: state.maxScrollDepth,
            totalSessionDurationMs: totalSessionDurationMs(),
            isBounce: isBounce()
        };
        if (extra) {
            for (var key in extra) {
                if (Object.prototype.hasOwnProperty.call(extra, key)) {
                    payload[key] = extra[key];
                }
            }
        }
        return payload;
    }

    function request(method, path, body, useBeacon) {
        var url = apiBase() + path;
        if (!apiBase()) return Promise.resolve();

        var headers = {
            "Content-Type": "application/json",
            "X-API-Key": apiKey()
        };

        if (useBeacon && navigator.sendBeacon) {
            var beaconUrl = url + "?apiKey=" + encodeURIComponent(apiKey());
            var blob = new Blob([JSON.stringify(body)], { type: "application/json" });
            navigator.sendBeacon(beaconUrl, blob);
            return Promise.resolve();
        }

        return fetch(url, {
            method: method,
            headers: headers,
            body: JSON.stringify(body),
            keepalive: method === "PATCH" || method === "POST"
        }).catch(function () { });
    }

    function clearPending() {
        state.pendingClicks = [];
        state.pendingPages = [];
        state.pendingComments = [];
    }

    function flush(extra, useBeacon) {
        if (!state.started || !apiBase()) return Promise.resolve();
        finalizeCurrentPageDuration();
        var payload = buildPayload(extra);
        if (payload.pages.length === 0 && payload.clicks.length === 0 && payload.comments.length === 0 && !extra) {
            return Promise.resolve();
        }
        clearPending();
        return request("PATCH", "/api/sessions/" + encodeURIComponent(state.sessionId), payload, useBeacon);
    }

    function finalizeCurrentPageDuration() {
        if (!state.currentPage || !state.currentPage.enteredAtMs) return;
        var durationMs = Date.now() - state.currentPage.enteredAtMs;
        state.currentPage.durationMs = durationMs;
        state.currentPage.leftAt = nowIso();
        var existing = state.pendingPages.filter(function (p) {
            return p.path === state.currentPage.path && !p.durationMs;
        });
        if (existing.length === 0) {
            state.pendingPages.push(state.currentPage);
        }
    }

    function recordPageView() {
        finalizeCurrentPageDuration();
        state.maxScrollDepth = 0;
        state.currentPage = {
            path: window.location.pathname + window.location.search,
            title: document.title || "",
            enteredAt: nowIso(),
            enteredAtMs: Date.now(),
            durationMs: 0
        };
    }

    function onClick(event) {
        if (!state.started) return;
        var el = event.target;
        var tag = el.tagName || "";
        var href = "";
        if (el.closest) {
            var link = el.closest("a");
            if (link) href = link.getAttribute("href") || "";
        }
        state.pendingClicks.push({
            path: window.location.pathname,
            tag: tag,
            href: href,
            label: clickLabel(el),
            at: nowIso()
        });
    }

    function onScroll() {
        var doc = document.documentElement;
        var scrollTop = window.scrollY || doc.scrollTop;
        var height = doc.scrollHeight - doc.clientHeight;
        if (height <= 0) return;
        var depth = Math.round((scrollTop / height) * 100);
        if (depth > state.maxScrollDepth) state.maxScrollDepth = depth;
    }

    function submitComment() {
        var input = document.getElementById("commentInput");
        if (!input) return;
        var text = (input.value || "").trim();
        if (!text) return;
        state.pendingComments.push({
            path: window.location.pathname,
            text: text,
            at: nowIso()
        });
        input.value = "";
        // Flush immediately so the comment isn't lost if the user leaves right after
        flush();
    }

    function bindCommentBox() {
        var btn = document.getElementById("commentBtn");
        var input = document.getElementById("commentInput");
        if (btn) {
            btn.addEventListener("click", function (e) {
                e.preventDefault();
                submitComment();
            });
        }
        if (input) {
            input.addEventListener("keydown", function (e) {
                if (e.key === "Enter") {
                    e.preventDefault();
                    submitComment();
                }
            });
        }
    }

    function onExit(useBeacon) {
        if (!state.started) return;
        finalizeCurrentPageDuration();
        var exitPayload = {
            sessionId: state.sessionId,
            visitorId: state.visitorId,
            exitAt: nowIso(),
            exitUrl: window.location.href,
            totalSessionDurationMs: totalSessionDurationMs(),
            isBounce: isBounce(),
            pages: state.currentPage ? [state.currentPage] : [],
            clicks: state.pendingClicks.slice(),
            comments: state.pendingComments.slice(),
            scrollDepth: state.maxScrollDepth
        };
        state.pendingClicks = [];
        state.pendingComments = [];
        if (useBeacon) {
            var beaconUrl = apiBase() + "/api/sessions/" + encodeURIComponent(state.sessionId) +
                "/flush?apiKey=" + encodeURIComponent(apiKey());
            if (navigator.sendBeacon) {
                var blob = new Blob([JSON.stringify(exitPayload)], { type: "application/json" });
                navigator.sendBeacon(beaconUrl, blob);
            }
            return;
        }
        flush({
            exitAt: exitPayload.exitAt,
            exitUrl: exitPayload.exitUrl,
            totalSessionDurationMs: exitPayload.totalSessionDurationMs,
            isBounce: exitPayload.isBounce
        });
    }

    function startFlushTimer() {
        var interval = config().flushIntervalMs || 8000;
        if (state.flushTimer) clearInterval(state.flushTimer);
        state.flushTimer = setInterval(function () {
            flush();
        }, interval);
    }

    function start() {
        if (state.started) return;
        state.started = true;
        state.sessionId = getOrCreateSessionId();
        state.visitorId = getOrCreateVisitorId();
        state.entryAt = sessionStorage.getItem(ENTRY_AT_KEY) || nowIso();
        sessionStorage.setItem(ENTRY_AT_KEY, state.entryAt);
        sessionStorage.setItem("visitorEntryUrl", window.location.href);

        recordPageView();

        var payload = buildPayload();
        request("POST", "/api/sessions", payload).then(function () {
            startFlushTimer();
        });

        document.addEventListener("click", onClick, true);
        window.addEventListener("scroll", onScroll, { passive: true });
        window.addEventListener("pagehide", function () { onExit(true); });
        window.addEventListener("beforeunload", function () { onExit(true); });
        document.addEventListener("visibilitychange", function () {
            if (document.visibilityState === "hidden") onExit(true);
        });
        bindCommentBox();
    }

    function enforceConsent() {
        if (isDeclinedPage()) return;
        if (hasConsent()) {
            start();
            return;
        }
        if (!isHomePage()) {
            window.location.replace(homeUrl());
        }
    }

    window.VisitorTracker = {
        start: start,
        flush: flush,
        hasConsent: hasConsent
    };

    document.addEventListener("DOMContentLoaded", enforceConsent);
})();