"""Real failure corpus for Latch: runs under real pytest against real libraries.

These tests are deliberately failing so pytest emits genuine JUnit XML with real
exception types, messages and tracebacks. The *distribution* of failures is
designed (a real red CI run's logs are auth-gated on GitHub); the messages are
not.

    /tmp/latch-venv/bin/pytest experiments/real-pytest \
        --junitxml=experiments/real-pytest/results.xml -q
"""

import json
import socket
import sqlite3
import urllib.request


def _fetch(url: str) -> bytes:
    with urllib.request.urlopen(url, timeout=1) as response:
        return response.read()


def _invoice_total(quantity: int, unit_cents: int) -> int:
    return quantity * unit_cents


# --- env cascade: a shared service is down (one root cause, many tests) ------


def test_checkout_service_health() -> None:
    _fetch("http://127.0.0.1:8080/health")


def test_checkout_service_post_order() -> None:
    _fetch("http://127.0.0.1:8080/api/orders")


def test_checkout_service_get_cart() -> None:
    _fetch("http://127.0.0.1:8080/api/cart")


def test_checkout_service_apply_coupon() -> None:
    _fetch("http://127.0.0.1:8080/api/coupon")


def test_checkout_service_list_payments() -> None:
    _fetch("http://127.0.0.1:8080/api/payments")


def test_checkout_service_refund() -> None:
    _fetch("http://127.0.0.1:8080/api/refund")


def test_checkout_service_ship() -> None:
    _fetch("http://127.0.0.1:8080/api/ship")


def test_checkout_service_track() -> None:
    _fetch("http://127.0.0.1:8080/api/track")


# --- a shared timeout: an unreachable dependency ------------------------------


def _connect_unreachable() -> None:
    socket.create_connection(("10.255.255.1", 81), timeout=0.3)


def test_report_timeout() -> None:
    _connect_unreachable()


def test_report_timeout_export() -> None:
    _connect_unreachable()


def test_report_timeout_pdf() -> None:
    _connect_unreachable()


# --- one product regression surfacing in several tests ------------------------


def test_invoice_total_list() -> None:
    assert _invoice_total(41, 100) == 4200


def test_invoice_total_detail() -> None:
    assert _invoice_total(41, 100) == 4200


def test_invoice_total_email() -> None:
    assert _invoice_total(41, 100) == 4200


def test_invoice_total_pdf() -> None:
    assert _invoice_total(41, 100) == 4200


# --- distinct assertion failures ---------------------------------------------


def test_cart_item_count() -> None:
    items = ["apple", "pear"]
    assert len(items) == 3


def test_user_display_name() -> None:
    name = "bob"
    assert name == "alice"


def test_feature_flag_enabled() -> None:
    enabled = False
    assert enabled is True


def test_receipt_contains_vat() -> None:
    receipt = "Subtotal: 10.00 Total: 10.00"
    assert "VAT" in receipt


# --- distinct real exceptions ------------------------------------------------


def test_parse_malformed_config() -> None:
    json.loads('{"retries": ')


def test_open_missing_fixture() -> None:
    with open("/nonexistent/latch/fixture.json", encoding="utf-8") as handle:
        handle.read()


def test_read_absent_metric() -> None:
    metrics = {"latency_p99": 12}
    metrics["error_rate"]


def test_unit_price_ratio() -> None:
    quantity = 0
    return_value = 100 / quantity
    assert return_value == 0


def test_open_database() -> None:
    sqlite3.connect("/nonexistent-dir/latch.sqlite3").execute("select 1")
