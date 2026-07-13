# DEPLOYMENT.md — Deploying SIPAR Backend to Render

This guide walks you through getting the FastAPI backend running on Render so
the mobile app works without anyone's laptop being on or connected to the same
Wi-Fi network.

---

## Prerequisites

- A **GitHub account** with the SIPAR repo pushed to it (public or private both work).
- A **Render account** — sign up free at https://render.com.
- Your **Anthropic API key** (from https://console.anthropic.com).

---

## Step 1 — Push the repo to GitHub

If you haven't already:

```bash
git remote add origin https://github.com/<your-username>/SIPAR.git
git push -u origin main
```

---

## Step 2 — Create a new Web Service on Render

1. Log in to Render → **New +** → **Web Service**.
2. Connect your GitHub account and select the **SIPAR** repository.
3. Configure the service:

| Setting | Value |
|---|---|
| **Name** | `sipar-backend` (or anything you like) |
| **Root Directory** | `backend` |
| **Environment** | `Python 3` |
| **Build Command** | `pip install -r requirements.txt` |
| **Start Command** | `uvicorn app.main:app --host 0.0.0.0 --port $PORT` |
| **Instance Type** | Free (sufficient for small-scale testing) |

> The `backend/app/main.py` entry point also reads `$PORT` via
> `os.environ.get("PORT", 8000)` so it works whether started by Render or run
> directly with `python -m app.main`.

---

## Step 3 — Add environment variables

In the Render dashboard → **Environment** tab, add:

| Key | Value |
|---|---|
| `ANTHROPIC_API_KEY` | `sk-ant-…` (your actual key) |

**Do not commit** your `.env` file with a real API key to GitHub.
The `.gitignore` already excludes `backend/.env` — keep it that way.

---

## Step 4 — Deploy

Click **Create Web Service**. Render will:
1. Clone your repo.
2. Run `pip install -r requirements.txt`.
3. Start the server.

Wait ~2 minutes for the first deploy. You will see logs in the Render dashboard.
When it prints `Uvicorn running on http://0.0.0.0:<PORT>` the service is live.

Your public URL will look like:
```
https://sipar-backend.onrender.com
```

---

## Step 5 — Connect the mobile app

Open `mobile/src/config.ts` and make two edits:

```typescript
const ENV: 'development' | 'production' = 'production';   // change to production

const PROD_API_URL = 'https://sipar-backend.onrender.com'; // paste your Render URL
```

Rebuild and run the app — it will now hit the cloud backend.

---

## Step 6 — Verify the health endpoint

Visit `https://sipar-backend.onrender.com/health` in a browser.
You should see:
```json
{"status": "ok"}
```

---

## Notes & Caveats

**Cold starts:** The free Render tier spins the service down after 15 minutes of
inactivity. The first request after sleep takes ~30 s. Subsequent requests are
fast. Upgrade to a Starter instance ($7/month) to avoid this during real teacher
test sessions.

**Storage:** Uploaded images live in Render's ephemeral filesystem and are deleted
after OCR extraction confirms (Phase 7 cleanup). The SQLite database resets on
every new deploy — for a production system, migrate to a persistent store (e.g.
Render's managed PostgreSQL).

**Spreadsheets:** Excel files are compiled on demand and streamed directly to the
phone. The server does not retain them after the download completes.

**CORS:** The backend currently allows all origins (`*`). Fine for a closed teacher
testing group; tighten `allow_origins` in `backend/app/main.py` if usage widens.
