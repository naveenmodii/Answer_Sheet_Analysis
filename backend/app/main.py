"""
SIPAR Backend — FastAPI application entry point.
"""
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
    # Phase 1: image upload dir is created on first request (see submissions.py).
    # Future: initialise MongoDB motor client, warm up OpenCV.
    yield
    # ---------------------------------------------------------------------------
    # Shutdown
    # ---------------------------------------------------------------------------
    # Future: close MongoDB motor client.


app = FastAPI(
    title="SIPAR API",
    description="Smart Integrated Photo-to-Answer-Records — backend API.",
    version="0.1.0",
    lifespan=lifespan,
)

# ---------------------------------------------------------------------------
# CORS — allow all origins in development; tighten for production.
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
