"""
Service-level tests: the shared-secret gate in front of /ask.

Worth pinning because the failure is silent and expensive. If this check regresses, the
backend still works perfectly — it just also works for anyone who finds the URL, and the
first symptom is the provider bill.
"""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from app import main


@pytest.fixture
def client(monkeypatch):
    monkeypatch.setenv("BACKEND_API_KEY", "correct-horse-battery-staple")
    return TestClient(main.app)


def test_ask_rejects_missing_key(client):
    r = client.post("/ask", json={"question": "what is HbA1c"})
    assert r.status_code == 401


def test_ask_rejects_wrong_key(client):
    r = client.post("/ask", json={"question": "what is HbA1c"}, headers={"X-API-Key": "nope"})
    assert r.status_code == 401


def test_ask_accepts_correct_key(client, monkeypatch):
    """The agent is stubbed: this asserts the gate opens, not that retrieval works."""
    monkeypatch.setattr(
        main,
        "ask",
        lambda q, category=None, mode=None: {
            "refused": False,
            "answer": "stub",
            "citations": [],
            "hits": [],
            "queries": [q],
            "trace": [],
            "total_ms": 1,
            "input_tokens": 0,
            "output_tokens": 0,
        },
    )
    r = client.post(
        "/ask",
        json={"question": "what is HbA1c"},
        headers={"X-API-Key": "correct-horse-battery-staple"},
    )
    assert r.status_code == 200
    assert r.json()["answer"] == "stub"


def test_gate_is_open_when_no_secret_is_configured(monkeypatch):
    """Local development must not require setup; production sets the variable."""
    monkeypatch.delenv("BACKEND_API_KEY", raising=False)
    monkeypatch.setattr(
        main,
        "ask",
        lambda q, category=None, mode=None: {
            "refused": True,
            "refusal_reason": "stub",
            "hits": [],
            "queries": [q],
            "trace": [],
            "total_ms": 1,
        },
    )
    r = TestClient(main.app).post("/ask", json={"question": "anything"})
    assert r.status_code == 200


def test_health_needs_no_key(client):
    r = client.get("/health")
    assert r.status_code == 200
    assert r.json()["briefs"] == 52


def test_meta_reports_the_shipped_configuration(client):
    """The page renders these, so a drift between copy and pipeline shows up here."""
    body = client.get("/meta").json()
    assert body["retrieval_mode"] == "dense"
    assert body["brief_count"] == 52
    assert 0 < body["min_score"] < 1
