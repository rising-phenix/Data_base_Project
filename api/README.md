# Visitor Tracker API

Node.js + Express API that stores visitor sessions in **MongoDB Atlas**. Used by the Daily Blog static site and the Java admin sync app.

## Setup

1. Copy `.env.example` to `.env` and fill in values.
2. Install dependencies:

```bash
cd api
npm install
```

3. Run locally:

```bash
npm start
```

Health check: `GET http://localhost:3000/health`

## MongoDB Atlas

1. Create a free cluster at [mongodb.com/atlas](https://www.mongodb.com/atlas).
2. Database Access → add a database user.
3. Network Access → allow `0.0.0.0/0` (or your deploy host IP only).
4. Connect → Drivers → copy connection string into `MONGODB_URI`.

Database: `daily_blog`  
Collection: `visitor_sessions`

## Deploy on Back4App Containers

Back4App runs your API as a **Docker container**. Use **Containers as a Service** (not the Parse BaaS dashboard).

### 1. Push `api/` to GitHub

Ensure your repo (`rising-phenix/Data_base_Project`) includes the `api/` folder with `Dockerfile`, `server.js`, and `package.json`. Do not commit `node_modules` or `.env`.

### 2. Create the container app

1. Log in at [back4app.com](https://www.back4app.com)
2. **Build a new app** → choose **Containers as a Service** (not Backend as a Service)
3. Connect **GitHub** and select `Data_base_Project`
4. Deployment settings:
   - **Root directory:** `api`
   - **Branch:** `main`
   - **Dockerfile path:** `Dockerfile` (default inside `api/`)
   - **Auto-deploy:** Yes (optional)

### 3. Environment variables

In Back4App → your app → **Settings** → **Environment variables**, add:

| Variable | Example |
|----------|---------|
| `MONGODB_URI` | `mongodb+srv://user:pass@cluster.mongodb.net/...` |
| `API_KEY` | `my-secret-write-key` |
| `ADMIN_API_KEY` | `my-admin-read-key` |
| `CORS_ORIGINS` | `https://rising-phenix.github.io` |
| `PORT` | `3000` (if not set automatically) |

### 4. Deploy and get URL

Click **Create app** / deploy. When finished, open **Actions** → copy the app URL (e.g. `https://your-app-name.back4app.io`).

Test: `https://YOUR-URL/health` should return `{"ok":true}`.

### 5. Update the website

In `scripts/tracker-config.js`:

```javascript
window.TRACKER_CONFIG = {
    apiBaseUrl: "https://YOUR-URL.back4app.io",
    apiKey: "same-as-API_KEY",
    flushIntervalMs: 8000
};
```

Push to GitHub Pages.

Docs: [Back4App Containers – Express](https://www.back4app.com/docs-containers/run-an-express-container-app) | [Get started](https://www.back4app.com/docs-containers/get-started)

## Deploy on Render (alternative)

1. Push this repo to GitHub.
2. [render.com](https://render.com) → New **Web Service** → connect repo.
3. **Root directory:** `api`
4. **Build command:** `npm install`
5. **Start command:** `npm start`
6. Environment variables (from `.env.example`):
   - `MONGODB_URI`
   - `API_KEY` (same value as in `scripts/tracker-config.js`)
   - `ADMIN_API_KEY` (for Java app reads)
   - `CORS_ORIGINS=https://rising-phenix.github.io`
7. Copy the public URL (e.g. `https://daily-blog-api.onrender.com`).

## Configure the website

Edit [`scripts/tracker-config.js`](../scripts/tracker-config.js):

```javascript
window.TRACKER_CONFIG = {
    apiBaseUrl: "https://your-service.onrender.com",
    apiKey: "same-as-API_KEY-env-var",
    flushIntervalMs: 8000
};
```

Commit and push → GitHub Pages picks up the change.

## API endpoints

| Method | Path | Auth | Purpose |
|--------|------|------|---------|
| POST | `/api/sessions` | `X-API-Key` | Create session (after terms Agree) |
| PATCH | `/api/sessions/:sessionId` | `X-API-Key` | Append pages, clicks, exit |
| POST | `/api/sessions/:sessionId/flush` | `apiKey` query or header | Exit beacon (tab close) |
| GET | `/api/sessions?since=ISO8601` | Admin key | List sessions for Java sync |
| GET | `/api/sessions/:sessionId` | Admin key | Single session |

See [JAVA_API.md](../docs/JAVA_API.md) for the Java admin integration contract.

## Test locally

1. Start API with valid `MONGODB_URI`.
2. Open `index.html` via Live Server or similar.
3. Agree to terms → DevTools Network → `POST /api/sessions`.
4. Browse pages → periodic `PATCH` requests.
5. Close tab → `POST .../flush` via `sendBeacon`.
