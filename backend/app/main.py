"""
ASA Backend — FastAPI application entry point.
"""
import os
from contextlib import asynccontextmanager

from dotenv import load_dotenv
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.routers import health, submissions

load_dotenv()  # Load .env (if present) before anything else


@asynccontextmanager
async def lifespan(app: FastAPI):
    # ---------------------------------------------------------------------------
    # Startup
    # ---------------------------------------------------------------------------
    from app.services.database import init_db
    try:
        init_db()
    except Exception as e:
        print(f"Failed to initialize SQLite database: {e}")
    yield
    # ---------------------------------------------------------------------------
    # Shutdown
    # ---------------------------------------------------------------------------
    # Future: close MongoDB motor client.


app = FastAPI(
    title="ASA API",
    description="Answer Sheet Analysis — backend API.",
    version="0.1.0",
    lifespan=lifespan,
)

# ---------------------------------------------------------------------------
# CORS
# ---------------------------------------------------------------------------
# allow_origins=["*"] is intentionally permissive for small-scale teacher
# testing where the client is a physical Android/iOS device on the same
# network (or connecting to a cloud-hosted backend). If this were ever
# expanded to a real production deployment with web clients, tighten this
# to an explicit allowlist: allow_origins=["https://your-domain.com"].
# ---------------------------------------------------------------------------
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ---------------------------------------------------------------------------
# Routers
# ---------------------------------------------------------------------------
app.include_router(health.router)
app.include_router(submissions.router)
# Future: app.include_router(extraction.router, prefix="/extraction")

# ---------------------------------------------------------------------------
# Local / Render entry point
# ---------------------------------------------------------------------------
# On Render the platform sets $PORT dynamically.  Locally it defaults to 8000.
# Run directly with: python -m app.main   (or uvicorn app.main:app --port 8000)
# ---------------------------------------------------------------------------
if __name__ == "__main__":
    import uvicorn
    port = int(os.environ.get("PORT", 8000))
    uvicorn.run("app.main:app", host="0.0.0.0", port=port, reload=False)

