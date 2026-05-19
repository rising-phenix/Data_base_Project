(function () {
    "use strict";

    var SESSION_ID_KEY = "visitorSessionId";
    var TERMS_KEY = "termsAccepted";
    var ENTRY_AT_KEY = "visitorEntryAt";

    var state = {
        started: false,
        sessionId: null,
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


    function finalizeCurrentPage() {
        if (!state.currentPage) return;
        var durationMs = Date.now() - state.currentPage.enteredAtMs;
        var page = {
            path: state.currentPage.path,
            title: state.currentPage.title,
            enteredAt: state.currentPage.enteredAt,
            leftAt: nowIso(),
            durationMs: durationMs
        };
        state.pendingPages.push(page);
        state.currentPage = null;
    }

    function recordPageView() {
        finalizeCurrentPage();
        state.maxScrollDepth = 0;
        state.currentPage = {
            path: window.location.pathname + window.location.search,
            title: document.title || "",
            enteredAt: nowIso(),
            enteredAtMs: Date.now()
        };
    }


    function buildPayload(extra) {
        var payload = {
            sessionId: state.sessionId,
            termsAcceptedAt: state.entryAt,
            entryUrl: sessionStorage.getItem("visitorEntryUrl") || window.location.href,
            device: deviceInfo(),
            referrer: document.referrer || "",
            pages: state.pendingPages.slice(),
            clicks: state.pendingClicks.slice(),
            comments: state.pendingComments.slice(),
            scrollDepth: state.maxScrollDepth
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

        if (useBeacon && navigator.sendBeacon) {
            var beaconUrl = url + "?apiKey=" + encodeURIComponent(apiKey());
            var blob = new Blob([JSON.stringify(body)], { type: "application/json" });
            navigator.sendBeacon(beaconUrl, blob);
            return Promise.resolve();
        }

        return fetch(url, {
            method: method,
            headers: {
                "Content-Type": "application/json",
                "X-API-Key": apiKey()
            },
            body: JSON.stringify(body),
            keepalive: true
        }).catch(function () { });
    }

    function clearPending() {
        state.pendingClicks = [];
        state.pendingPages = [];
        state.pendingComments = [];
    }


    function flush(extra, useBeacon) {
        if (!state.started || !apiBase()) return Promise.resolve();

        
        if (state.currentPage) {
            var durationMs = Date.now() - state.currentPage.enteredAtMs;
            state.pendingPages.push({
                path: state.currentPage.path,
                title: state.currentPage.title,
                enteredAt: state.currentPage.enteredAt,
                leftAt: nowIso(),
                durationMs: durationMs
            });
            state.currentPage.enteredAtMs = Date.now();
        }

        var payload = buildPayload(extra);

        var hasData = payload.pages.length > 0 ||
            payload.clicks.length > 0 ||
            payload.comments.length > 0 ||
            payload.scrollDepth > 0 ||
            extra;

        if (!hasData) return Promise.resolve();

        clearPending();
        return request("PATCH", "/api/sessions/" + encodeURIComponent(state.sessionId), payload, useBeacon);
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


    function hookCommentForms() {
        document.addEventListener("click", function (e) {
            var btn = e.target;
            if (!btn) return;
            var isCommentBtn = btn.id === "commentBtn" ||
                (btn.closest && btn.closest(".comment-box") && btn.tagName === "BUTTON");
            if (!isCommentBtn) return;

            var box = btn.closest(".comment-box") || document;
            var input = box.querySelector("#commentInput") || box.querySelector("input[type='text']");
            var text = input ? (input.value || "").trim() : "";
            if (!text) return;

            state.pendingComments.push({
                path: window.location.pathname,
                text: text.slice(0, 1000),
                at: nowIso()
            });

            flush();
        }, true);
    }


    function onExit(useBeacon) {
        if (!state.started) return;

        var exitAt = nowIso();
        var entryAt = new Date(state.entryAt).getTime();
        var totalMs = Date.now() - entryAt;

        var pages = state.pendingPages.slice();
        if (state.currentPage) {
            pages.push({
                path: state.currentPage.path,
                title: state.currentPage.title,
                enteredAt: state.currentPage.enteredAt,
                leftAt: exitAt,
                durationMs: Date.now() - state.currentPage.enteredAtMs
            });
        }

        var exitPayload = {
            sessionId: state.sessionId,
            exitAt: exitAt,
            exitUrl: window.location.href,
            totalSessionDurationMs: totalMs,
            isBounce: pages.length <= 1,
            pages: pages,
            clicks: state.pendingClicks.slice(),
            comments: state.pendingComments.slice(),
            scrollDepth: state.maxScrollDepth
        };

        state.pendingClicks = [];
        state.pendingComments = [];
        state.pendingPages = [];

        var flushUrl = apiBase() + "/api/sessions/" + encodeURIComponent(state.sessionId) +
            "/flush?apiKey=" + encodeURIComponent(apiKey());

        if (useBeacon && navigator.sendBeacon) {
            var blob = new Blob([JSON.stringify(exitPayload)], { type: "application/json" });
            navigator.sendBeacon(flushUrl, blob);
        } else {
            request("POST", "/api/sessions/" + encodeURIComponent(state.sessionId) + "/flush", exitPayload, false);
        }
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
        state.entryAt = sessionStorage.getItem(ENTRY_AT_KEY) || nowIso();
        sessionStorage.setItem(ENTRY_AT_KEY, state.entryAt);
        sessionStorage.setItem("visitorEntryUrl", window.location.href);

        recordPageView();
        hookCommentForms();

        var payload = buildPayload({ exitAt: null });
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