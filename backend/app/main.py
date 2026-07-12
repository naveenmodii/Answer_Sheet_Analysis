"""
SIPAR Backend — FastAPI application entry point.
"""
from contextlib import asynccontextmanager

from dotenv import load_dotenv
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.routers import health

load_dotenv()  # Load .env (if present) before anything else


@asynccontextmanager
async def lifespan(app: FastAPI):
    # ---------------------------------------------------------------------------
    # Startup
    # ---------------------------------------------------------------------------
    # Phase 1: initialise MongoDB motor client here.
    # Phase 1: warm up any other resources (e.g. pre-load OpenCV calibration).
    yield
    # ---------------------------------------------------------------------------
    # Shutdown
    # ---------------------------------------------------------------------------
    # Phase 1: close the MongoDB motor client here.


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
# Phase 1: app.include_router(marks.router, prefix="/marks")
