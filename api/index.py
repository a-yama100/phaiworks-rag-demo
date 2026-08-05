"""
Vercel entry point for the backend.

Vercel's Python runtime looks for a module-level ASGI app in a file under api/, so this
re-exports the FastAPI application. Everything real lives in rag/ — this file exists to
satisfy a filesystem convention and should stay this short.

Locally the same app runs under uvicorn directly:

    .venv/Scripts/python.exe -m uvicorn rag.main:app --app-dir api --port 8000
"""

import sys
from pathlib import Path

# The function is invoked with the repository root as the working directory, so `rag`
# is not importable without this. It has to come FIRST: the repository root contains a
# Next.js `app/` directory, which Python would otherwise happily treat as a namespace
# package and shadow anything similarly named. The Python package was renamed from `app`
# to `rag` for the same reason — relying on path order alone to dodge that collision is
# the kind of thing that works until someone reorders an import.
sys.path.insert(0, str(Path(__file__).resolve().parent))

from rag.main import app  # noqa: E402

__all__ = ["app"]
