# Deploying

Two supported shapes. Both are in the repository; the difference is one environment
variable.

| | Co-deployed on Vercel | Container (Render, Fly, Cloud Run) |
|---|---|---|
| Backend runs as | `api/index.py`, a Python function in the same project | `api/Dockerfile`, its own service |
| Extra account | none | yes |
| Key isolation | shared project environment | separate process, separate environment |
| Cold start | per-invocation, several seconds | none while the instance is warm |
| Config | leave `BACKEND_URL` unset | set `BACKEND_URL` to the service URL |

**Start with the co-deployed shape.** It needs no new account, and the pattern is already
proven in this Vercel account by `etax-xml-demo`. Move to a container when cold starts or
the 250 MB function bundle limit start to bite — the blueprint is committed and ready.

---

## Shape A — co-deployed on Vercel

Nothing to create. `vercel.json` already declares the function, and `requirements.txt` at
the repository root is what Vercel's Python runtime installs.

### 1. Environment variables

Vercel project → Settings → Environment Variables:

| Action | Variable | Value |
|---|---|---|
| add | `PINECONE_API_KEY` | the current key — also at `D:\SoftWare\API\Pinecone API key.txt` |
| add | `GOOGLE_API_KEY` | the same value the sites use in their `.env.local` |
| add | `PINECONE_INDEX` | `clinical-kb-gemini` |
| add | `BACKEND_API_KEY` | any long random string — the proxy and the function compare it |
| delete | `MIN_SCORE` | now backend-side, and the value there is stale |

`BACKEND_URL` is deliberately **not** set: with the backend in the same deployment, the
proxy falls back to `VERCEL_URL`, so preview deployments talk to their own backend rather
than to production.

### 2. Ship

```bash
git checkout main
git merge feat/langgraph-agent-eval
git push origin main
```

Vercel builds on push (`vercel.json` → `deploymentEnabled.main`). The commit author must be
`yama0226@gmail.com` or the deployment is blocked — do not override the author.

### 3. Verify

```bash
curl https://rag-demo.phaiworks.com/api/py/health
```

Expected `{"ok":true,"briefs":52}`. A `briefs` count of 0 means `data/` was not bundled —
that is the `includeFiles` glob in `vercel.json`.

```bash
curl -s https://rag-demo.phaiworks.com/api/ask \
  -H "Content-Type: application/json" \
  -d '{"question":"the iron test that is not thrown off by inflammation"}'
```

Expected: `refused: false`, citing `BRIEF-TRANSFERRIN-SATURATION-001`, with a `trace`
array. Then in a browser:

- `/` — ask *"what dose of levothyroxine should I take"* and confirm it declines with
  `model_declined` and shows the trace
- `/evals` — confirm the measured numbers render, not the "not run" placeholder

A 502 from `/api/ask` means the proxy could not reach the function, or the shared secret
does not match. The real cause is in the Vercel function logs; the browser only ever sees
a generic message, on purpose.

### Two things that will waste an afternoon if they are not already in place

Both were hit on the first production deploy. Both look like the backend is broken when it
is not.

**The rewrite in `next.config.ts` is load-bearing.** Without
`/api/py/:path* → /api/`, Next.js owns every path under `/api` and answers
`/api/py/health` with its own 404 page. The function deploys correctly and is simply never
reached, which is indistinguishable from a failed deployment unless you check the build
log and see it succeeded.

**Do not address the backend with `VERCEL_URL`.** It resolves to the per-deployment
`*.vercel.app` hostname, which Deployment Protection answers with a 302 to an auth page.
The proxy's request is redirected, `res.ok` is false, and every question returns "the
retrieval service is unavailable" — while `/api/py/health` returns 200 the whole time and
the backend is perfectly healthy. `BACKEND_URL` is set to the custom domain for this
reason; the code falls back to `VERCEL_PROJECT_PRODUCTION_URL`, never `VERCEL_URL`.

The useful diagnostic for both: call `/api/py/health` and `/api/py/ask` directly. If
health is 200 and a keyless `/api/py/ask` is 401, the backend is fine and the problem is
between the proxy and it.

### The honest caveat

In this shape the Next.js runtime and the Python function share one project environment,
so `GOOGLE_API_KEY` and `PINECONE_API_KEY` are present in both even though only the Python
side reads them. The browser still never sees a key and the Next.js code never touches
one, but this is not the process-level isolation the container shape gives. If that
distinction matters — a client asking how secrets are segregated, for instance — use
Shape B.

---

## Shape B — container

The repository contains `render.yaml`, so on Render this is a Blueprint deploy rather
than a hand-configured service.

1. Render → **New → Blueprint** → connect `a-yama100/phaiworks-rag-demo`, branch `main`.
2. It prompts for the two secrets marked `sync: false`: `PINECONE_API_KEY` and
   `GOOGLE_API_KEY`. `BACKEND_API_KEY` is generated — copy it.
3. Deploy, then check `https://<service>.onrender.com/api/py/health`.
4. On Vercel, set `BACKEND_URL` to the service URL (no trailing slash) and
   `BACKEND_API_KEY` to the generated value. Delete `PINECONE_API_KEY`, `GOOGLE_API_KEY`
   and `PINECONE_INDEX` from Vercel — in this shape the frontend genuinely holds nothing.
5. Push `main` as in Shape A.

`render.yaml` specifies `plan: free`, which spins down after inactivity and takes roughly
50 seconds to wake. Fine while nobody is looking at it, wrong for a link on a job
application — a reviewer gives a demo about fifteen seconds. Move to the paid tier before
the URL goes anywhere.

---

## Re-running the eval

The published numbers come from a run against the live index:

```bash
cd api
.venv/Scripts/python.exe eval/run_eval.py --sweep --sweep-weights --with-generation
```

This overwrites `public/eval-results.json`; commit and push it to update `/evals`. It
makes real API calls — retrieval is fractions of a cent, `--with-generation` about $0.05.

If the corpus changes, re-ingest first (`python ingest.py`), which re-embeds only the
briefs whose content hash changed.

---

## Rollback

Vercel: Deployments → an earlier one → Promote. Render: Events → Rollback. The Pinecone
index is untouched by either, and `ingest.py` is idempotent, so re-running it is always
safe.
