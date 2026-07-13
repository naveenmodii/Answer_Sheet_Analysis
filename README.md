# Answer Sheet Analysis — Smart Integrated Photo-to-Answer-Records

Answer Sheet Analysis is a mobile app that lets teachers photograph the cover page of an exam answer booklet and automatically extract student details and per-question marks via a vision-LLM, validate the arithmetic, and append the verified record as a row in an Excel file — turning a manual data-entry chore into a one-tap review-and-save workflow.

---

## Monorepo Structure

```
answer-sheet-analysis/
├── mobile/      # React Native (Expo bare workflow) + TypeScript
└── backend/     # Python FastAPI + uvicorn
```

---

## Running Locally

### Backend

```bash
cd backend

# 1. Create and activate a virtual environment
python -m venv .venv
source .venv/bin/activate          # Windows: .venv\Scripts\activate

# 2. Install dependencies
pip install -r requirements.txt

# 3. Copy env template and fill in your keys
cp .env.example .env
# Edit .env — add ANTHROPIC_API_KEY and MONGODB_URI

# 4. Start the dev server
uvicorn app.main:app --reload

# Health check
curl http://localhost:8000/health   # → {"status":"ok"}
# Interactive API docs
open http://localhost:8000/docs
```

### Mobile

```bash
cd mobile

# 1. Install JS dependencies
npm install

# 2a. Run on Android emulator / device (requires Android SDK)
npx expo run:android

# 2b. Run on iOS simulator (macOS + Xcode required)
npx expo run:ios

# 2c. Start the Metro bundler only (attach to an already-built dev-client)
npx expo start --dev-client
```

> **Note:** The bare workflow requires a native build step (`expo run:android` / `expo run:ios`).  
> Make sure you have the Android SDK installed and an emulator running (or a device connected via ADB) before step 2a.

---

## Environment Variables

| Variable | Service | Description |
|---|---|---|
| `ANTHROPIC_API_KEY` | backend | API key for Claude vision extraction |
| `MONGODB_URI` | backend | MongoDB connection string (e.g. Atlas or local) |

See `backend/.env.example` for the template.

---

## Tech Stack

| Layer | Technology |
|---|---|
| Mobile | React Native · Expo bare · TypeScript |
| Camera | react-native-vision-camera |
| State | Zustand |
| Navigation | React Navigation (native stack) |
| HTTP client | Axios |
| Backend | FastAPI · Python 3.11+ · Uvicorn |
| Image pre-processing | OpenCV |
| Extraction | Anthropic Claude API (vision) |
| Validation | Pydantic |
| Database | MongoDB via Motor (async) |
| Excel export | openpyxl |
