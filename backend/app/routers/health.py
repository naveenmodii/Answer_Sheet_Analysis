from fastapi import APIRouter

router = APIRouter(tags=["Health"])


@router.get("/health", summary="Health check")
async def health_check() -> dict:
    """Returns a simple status payload to confirm the API is running."""
    return {"status": "ok"}
