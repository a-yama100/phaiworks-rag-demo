"""
Retrieval evaluation: dense-only vs hybrid, on the gold set.

    python eval/run_eval.py                 # retrieval metrics for both modes
    python eval/run_eval.py --sweep         # also sweep MIN_SCORE to justify the threshold
    python eval/run_eval.py --with-generation  # also score citations (costs LLM calls)

Writes public/eval-results.json, which the /evals page renders. The point of publishing
it is that "we improved retrieval" is not a claim anyone should accept without the number
and the failure list next to it.

Scoring:
  top1 / recall@k / MRR   over the in-scope cases only
  refusal accuracy        over the out-of-scope cases only

Both matter and they trade against each other. A system tuned only for recall answers
every out-of-scope question with a confident wrong brief; a system tuned only for refusal
declines things it knows. Reporting one without the other hides which mistake was made.
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

from app.retrieval import Hit, best_dense_score, retrieve  # noqa: E402
from app.settings import (  # noqa: E402
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


def rank_of(hits: list[Hit], expected: str) -> int | None:
    for i, hit in enumerate(hits, start=1):
        if hit.name == expected:
            return i
    return None


def run_mode(cases: list[dict], mode: str, top_k: int = TOP_K) -> dict:
    in_scope = [c for c in cases if c.get("expect")]
    out_scope = [c for c in cases if not c.get("expect")]

    per_case: list[dict] = []
    latencies: list[float] = []

    for case in cases:
        started = time.perf_counter()
        hits = retrieve(case["question"], mode=mode, top_k=top_k)
        latencies.append((time.perf_counter() - started) * 1000)

        score = best_dense_score(hits)
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
                "best_dense_score": round(score, 4),
                # An out-of-scope case passes when nothing cleared the threshold.
                "passed": (rank == 1) if expected else (score < MIN_SCORE),
                "would_answer": score >= MIN_SCORE,
            }
        )

    scoped = [r for r in per_case if r["expect"]]
    unscoped = [r for r in per_case if not r["expect"]]
    ranks = [r["rank"] for r in scoped if r["rank"]]

    by_tag: dict[str, list[dict]] = defaultdict(list)
    for row in per_case:
        by_tag[row["tag"]].append(row)

    return {
        "mode": mode,
        "top_k": top_k,
        "in_scope_cases": len(in_scope),
        "out_of_scope_cases": len(out_scope),
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


def _pct(numerator: int, denominator: int) -> float:
    return round(numerator / denominator, 4) if denominator else 0.0


def sweep_threshold(result: dict, thresholds: list[float]) -> list[dict]:
    """
    Replay the recorded scores at different thresholds. No re-retrieval needed, so the
    sweep is free — and it shows the threshold was chosen from the curve rather than
    picked because it looked reasonable.
    """
    rows = []
    for t in thresholds:
        scoped = [c for c in result["cases"] if c["expect"]]
        unscoped = [c for c in result["cases"] if not c["expect"]]
        answered_correctly = sum(
            1 for c in scoped if c["rank"] == 1 and c["best_dense_score"] >= t
        )
        correctly_refused = sum(1 for c in unscoped if c["best_dense_score"] < t)
        rows.append(
            {
                "threshold": t,
                "answered_correctly": _pct(answered_correctly, len(scoped)),
                "correctly_refused": _pct(correctly_refused, len(unscoped)),
                # The number to optimise: both mistakes counted together.
                "combined": _pct(answered_correctly + correctly_refused, len(result["cases"])),
            }
        )
    return rows


def score_generation(cases: list[dict], mode: str) -> dict:
    """
    Citation validity over the in-scope set: does the model cite briefs that were
    actually retrieved, and does it refuse when it should?
    """
    from app.graph import ask

    checked = grounded = cited_expected = refused_when_should = 0
    oos_total = 0

    for case in cases:
        state = ask(case["question"], mode=mode)
        expected = case.get("expect")
        if expected:
            checked += 1
            if not state.get("refused"):
                grounded += 1
                retrieved = {h.brief_id for h in state.get("hits", [])}
                cited = set(state.get("citations", []))
                # The citation check in generate.py already rejects invented ids, so
                # anything that reaches here should be a subset. Assert it anyway —
                # a silent regression there would be invisible in every other metric.
                assert cited <= retrieved, f"{case['id']}: cited ids not retrieved"
                expected_brief = next(
                    (h.brief_id for h in state.get("hits", []) if h.name == expected), None
                )
                if expected_brief and expected_brief in cited:
                    cited_expected += 1
        else:
            oos_total += 1
            if state.get("refused"):
                refused_when_should += 1

    return {
        "in_scope_answered": _pct(grounded, checked),
        "cited_the_expected_brief": _pct(cited_expected, checked),
        "out_of_scope_refused": _pct(refused_when_should, oos_total),
        "chat_model": CHAT_MODEL,
    }


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--sweep", action="store_true", help="sweep the score threshold")
    parser.add_argument(
        "--with-generation",
        action="store_true",
        help="also run the full agent to score citations (costs LLM calls)",
    )
    parser.add_argument("--out", default=str(EVAL_RESULTS_PATH))
    args = parser.parse_args()

    cases = load_cases()
    print(f"Gold set: {len(cases)} cases from {GOLD_PATH.name}\n")

    results = {}
    for mode in ("dense", "hybrid"):
        print(f"Running {mode}…")
        results[mode] = run_mode(cases, mode)
        r = results[mode]
        print(
            f"  top1={r['top1']:.0%}  recall@{TOP_K}={r[f'recall_at_{TOP_K}']:.0%}  "
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

    if args.sweep:
        print("\nThreshold sweep (hybrid):")
        sweep = sweep_threshold(results["hybrid"], [0.15, 0.20, 0.25, 0.30, 0.35, 0.40, 0.45, 0.50])
        payload["threshold_sweep"] = sweep
        for row in sweep:
            print(
                f"  {row['threshold']:.2f}  answered={row['answered_correctly']:.0%}  "
                f"refused={row['correctly_refused']:.0%}  combined={row['combined']:.0%}"
            )

    if args.with_generation:
        print("\nScoring generation (this makes LLM calls)…")
        payload["generation"] = score_generation(cases, "hybrid")
        for key, value in payload["generation"].items():
            print(f"  {key}: {value}")

    out = Path(args.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(payload, indent=2), encoding="utf-8")
    print(f"\nWrote {out}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
