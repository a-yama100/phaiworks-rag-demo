# The backend runs anywhere that takes a container (Render, Fly, Cloud Run). It is a
# separate deployment from the Vercel frontend on purpose: keys stay on this side.
FROM python:3.11-slim

WORKDIR /srv

# Dependencies first so a code change does not reinstall the whole tree.
COPY api/requirements.txt ./api/requirements.txt
RUN pip install --no-cache-dir -r api/requirements.txt

# data/ lives at the repo root and is shared with the frontend, so the build context
# is the repo root rather than api/.
COPY data ./data
COPY api ./api

WORKDIR /srv/api

EXPOSE 8000
# Shell form so ${PORT} expands: most container hosts assign the port at runtime and
# health-check the one they assigned. Hardcoding 8000 passes locally and then fails
# deployment health checks for reasons the logs do not make obvious.
#
# Single worker: BM25 and the corpus are held in process memory, so every extra worker
# is another full copy of both. Scale with instances rather than workers.
CMD ["sh", "-c", "uvicorn app.main:app --host 0.0.0.0 --port ${PORT:-8000}"]
