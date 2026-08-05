"""
Retrieval evaluation: dense-only vs hybrid, on the gold set.

    python eval/run_eval.py                    # both modes
    python eval/run_eval.py --sweep            # + threshold sweep
    python eval/run_eval.py --sweep-weights    # + BM25 fusion weight sweep
    python eval/run_eval.py --with-generation  # + citation scoring (costs LLM calls)

Writes public/eval-results.json, which the /evals page renders. Publishing it is the
point: "we improved retrieval" is not a claim anyone should accept without the number
and the list of what still fails next to it.

Every case is retrieved ONCE. The dense and BM25 candidate lists are cached per case and
every mode, weight and threshold is then computed from that cache — so a sweep across
eleven fusion weights costs one embedding call per case, not eleven. That matters less
for the bill than for the honesty of the comparison: every configuration is scored
against byte-identical candidates, so a difference between them is the fusion and not
retrieval jitter.

Scoring:
  top1 / recall@k / MRR   over the in-scope cases only
  refusal accuracy        over the out-of-scope cases only

Both matter and they trade against each other. A pipeline tuned only for recall answers
every out-of-scope question with a confident wrong brief; one tuned only for refusal
declines things it knows. Reporting either alone hides which mistake is being made.
"""

from __future__ import annotations

import argparse
import json
import statistics
import sys
import time
from collections import defaultdict
from pathlib import Path

import yaml

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from rag.retrieval import (  # noqa: E402
    Hit,
    best_dense_score,
    dense_search,
    reciprocal_rank_fusion,
    sparse_search,
)
from rag.settings import (  # noqa: E402
    BM25_WEIGHT,
    CHAT_MODEL,
    EMBED_MODEL,
    EVAL_RESULTS_PATH,
    INDEX_NAME,
    MIN_SCORE,
    TOP_K,
)

GOLD_PATH = Path(__file__).resolve().parent / "gold.yaml"


def load_cases() -> list[dict]:
    with open(GOLD_PATH, encoding="utf-8") as f:
        return yaml.safe_load(f)["cases"]


def _pct(numerator: int, denominator: int) -> float:
    return round(numerator / denominator, 4) if denominator else 0.0


# --- retrieve once, score many times -----------------------------------------


def collect_candidates(cases: list[dict]) -> dict[str, dict]:
    cache: dict[str, dict] = {}
    for i, case in enumerate(cases, start=1):
        started = time.perf_counter()
        dense = dense_search(case["question"], None)
        sparse = sparse_search(case["question"], None)
        cache[case["id"]] = {
            "dense": dense,
            "sparse": sparse,
            "latency_ms": (time.perf_counter() - started) * 1000,
        }
        print(f"\r  retrieved {i}/{len(cases)}", end="", flush=True)
    print()
    return cache


def hits_for(entry: dict, weight: float | None, top_k: int) -> list[Hit]:
    """weight=None -> dense only. Otherwise fuse with BM25 at that weight."""
    if weight is None:
        return entry["dense"][:top_k]
    return reciprocal_rank_fusion(
        [entry["dense"], entry["sparse"]], weights=[1.0, weight]
    )[:top_k]


def rank_of(hits: list[Hit], expected: str) -> int | None:
    for i, hit in enumerate(hits, start=1):
        if hit.name == expected:
            return i
    return None


def score(cases: list[dict], cache: dict, weight: float | None, top_k: int = TOP_K) -> dict:
    per_case: list[dict] = []
    for case in cases:
        entry = cache[case["id"]]
        hits = hits_for(entry, weight, top_k)
        best = best_dense_score(hits)
        expected = case.get("expect")
        rank = rank_of(hits, expected) if expected else None
        per_case.append(
            {
                "id": case["id"],
                "tag": case["tag"],
                "question": case["question"],
                "expect": expected,
                "got": [h.name for h in hits],
                "rank": rank,
                "best_dense_score": round(best, 4),
                "passed": (rank == 1) if expected else (best < MIN_SCORE),
                "would_answer": best >= MIN_SCORE,
            }
        )

    scoped = [r for r in per_case if r["expect"]]
    unscoped = [r for r in per_case if not r["expect"]]
    ranks = [r["rank"] for r in scoped if r["rank"]]
    latencies = [cache[c["id"]]["latency_ms"] for c in cases]

    by_tag: dict[str, list[dict]] = defaultdict(list)
    for row in per_case:
        by_tag[row["tag"]].append(row)

    return {
        "mode": "dense" if weight is None else "hybrid",
        "bm25_weight": weight,
        "top_k": top_k,
        "in_scope_cases": len(scoped),
        "out_of_scope_cases": len(unscoped),
        "top1": _pct(sum(1 for r in scoped if r["rank"] == 1), len(scoped)),
        f"recall_at_{top_k}": _pct(len(ranks), len(scoped)),
        "mrr": round(sum(1 / r for r in ranks) / len(scoped), 4) if scoped else 0.0,
        "refusal_accuracy": _pct(sum(1 for r in unscoped if r["passed"]), len(unscoped)),
        "median_latency_ms": round(statistics.median(latencies)),
        "by_tag": {
            tag: {
                "n": len(rows),
                "passed": sum(1 for r in rows if r["passed"]),
                "accuracy": _pct(sum(1 for r in rows if r["passed"]), len(rows)),
            }
            for tag, rows in sorted(by_tag.items())
        },
        "failures": [
            {
                "id": r["id"],
                "tag": r["tag"],
                "question": r["question"],
                "expect": r["expect"],
                "got": r["got"][:3],
                "best_dense_score": r["best_dense_score"],
            }
            for r in per_case
            if not r["passed"]
        ],
        "cases": per_case,
    }


# --- sweeps ------------------------------------------------------------------


def sweep_weights(cases: list[dict], cache: dict) -> list[dict]:
    rows = []
    for weight in [None, 0.0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.7, 1.0]:
        r = score(cases, cache, weight)
        rows.append(
            {
                "bm25_weight": "dense-only" if weight is None else weight,
                "top1": r["top1"],
                f"recall_at_{TOP_K}": r[f"recall_at_{TOP_K}"],
                "mrr": r["mrr"],
            }
        )
    return rows


def sweep_threshold(result: dict) -> list[dict]:
    """
    Replay the recorded cosine scores at different thresholds. Free, because nothing is
    re-retrieved — and it shows the threshold came off a curve rather than being picked
    because it looked like a reasonable number.

    The range is derived from the data, not hardcoded: a fixed 0.15-0.50 range was the
    first version and it sat entirely below every score this embedding model produces,
    which is exactly how the refusal rate came out at 0% and looked like a code bug.
    """
    scores = [c["best_dense_score"] for c in result["cases"]]
    lo, hi = min(scores), max(scores)
    step = (hi - lo) / 20 or 0.01
    thresholds = [round(lo + step * i, 3) for i in range(21)]

    scoped = [c for c in result["cases"] if c["expect"]]
    unscoped = [c for c in result["cases"] if not c["expect"]]

    rows = []
    for t in thresholds:
        answered = sum(1 for c in scoped if c["rank"] == 1 and c["best_dense_score"] >= t)
        refused = sum(1 for c in unscoped if c["best_dense_score"] < t)
        rows.append(
            {
                "threshold": t,
                "answered_correctly": _pct(answered, len(scoped)),
                "correctly_refused": _pct(refused, len(unscoped)),
                "combined": _pct(answered + refused, len(result["cases"])),
            }
        )
    return rows


def score_generation(cases: list[dict]) -> dict:
    """
    End to end, through the agent. This is the only measurement that sees the second
    refusal mechanism: retrieval can only refuse on topical distance, and several
    out-of-scope cases here are squarely on topic (asking for a diagnosis, a drug dose,
    a product recommendation). Those can only be declined at generation time.
    """
    from rag.graph import ask

    checked = answered = cited_expected = 0
    oos_total = oos_refused = 0
    refusals: list[dict] = []

    for i, case in enumerate(cases, start=1):
        state = ask(case["question"])
        expected = case.get("expect")
        refused = bool(state.get("refused"))

        if expected:
            checked += 1
            if not refused:
                answered += 1
                retrieved = {h.brief_id for h in state.get("hits", [])}
                cited = set(state.get("citations", []))
                assert cited <= retrieved, f"{case['id']}: cited ids that were not retrieved"
                expected_brief = next(
                    (h.brief_id for h in state.get("hits", []) if h.name == expected), None
                )
                if expected_brief and expected_brief in cited:
                    cited_expected += 1
            else:
                refusals.append(
                    {"id": case["id"], "question": case["question"], "reason": state.get("refusal_reason", "")}
                )
        else:
            oos_total += 1
            oos_refused += refused
            if not refused:
                refusals.append(
                    {"id": case["id"], "question": case["question"], "reason": "ANSWERED (should not have)"}
                )
        print(f"\r  generated {i}/{len(cases)}", end="", flush=True)
    print()

    return {
        "in_scope_answered": _pct(answered, checked),
        "cited_the_expected_brief": _pct(cited_expected, checked),
        "out_of_scope_refused": _pct(oos_refused, oos_total),
        "chat_model": CHAT_MODEL,
        "notable": refusals,
    }


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--sweep", action="store_true", help="sweep the score threshold")
    parser.add_argument("--sweep-weights", action="store_true", help="sweep the BM25 fusion weight")
    parser.add_argument(
        "--with-generation",
        action="store_true",
        help="also run the full agent to score citations and real refusals (costs LLM calls)",
    )
    parser.add_argument("--out", default=str(EVAL_RESULTS_PATH))
    args = parser.parse_args()

    cases = load_cases()
    print(f"Gold set: {len(cases)} cases from {GOLD_PATH.name}")
    print("Retrieving candidates (once per case, reused for every configuration)…")
    cache = collect_candidates(cases)

    results = {"dense": score(cases, cache, None), "hybrid": score(cases, cache, BM25_WEIGHT)}
    for name, r in results.items():
        label = name if name == "dense" else f"hybrid(w={BM25_WEIGHT})"
        print(
            f"  {label:<16} top1={r['top1']:.0%}  recall@{TOP_K}={r[f'recall_at_{TOP_K}']:.0%}  "
            f"mrr={r['mrr']:.3f}  refusal={r['refusal_accuracy']:.0%}  "
            f"median={r['median_latency_ms']}ms  failures={len(r['failures'])}"
        )

    payload = {
        "generated_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "config": {
            "embed_model": EMBED_MODEL,
            "index": INDEX_NAME,
            "top_k": TOP_K,
            "min_score": MIN_SCORE,
            "bm25_weight": BM25_WEIGHT,
        },
        "gold_set_size": len(cases),
        "modes": results,
        "delta": {
            "top1": round(results["hybrid"]["top1"] - results["dense"]["top1"], 4),
            f"recall_at_{TOP_K}": round(
                results["hybrid"][f"recall_at_{TOP_K}"] - results["dense"][f"recall_at_{TOP_K}"], 4
            ),
            "mrr": round(results["hybrid"]["mrr"] - results["dense"]["mrr"], 4),
        },
    }

    if args.sweep_weights:
        print("\nBM25 fusion weight sweep:")
        rows = sweep_weights(cases, cache)
        payload["weight_sweep"] = rows
        for row in rows:
            print(
                f"  w={str(row['bm25_weight']):<11} top1={row['top1']:.0%}  "
                f"recall@{TOP_K}={row[f'recall_at_{TOP_K}']:.0%}  mrr={row['mrr']:.3f}"
            )

    if args.sweep:
        print("\nThreshold sweep (dense scores):")
        rows = sweep_threshold(results["dense"])
        payload["threshold_sweep"] = rows
        best = max(rows, key=lambda r: r["combined"])
        for row in rows:
            mark = "  <- best combined" if row is best else ""
            print(
                f"  {row['threshold']:.3f}  answered={row['answered_correctly']:.0%}  "
                f"refused={row['correctly_refused']:.0%}  combined={row['combined']:.0%}{mark}"
            )

    if args.with_generation:
        print("\nScoring generation end to end (makes LLM calls)…")
        payload["generation"] = score_generation(cases)
        for key, value in payload["generation"].items():
            if key != "notable":
                print(f"  {key}: {value}")

    out = Path(args.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(payload, indent=2), encoding="utf-8")
    print(f"\nWrote {out}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
