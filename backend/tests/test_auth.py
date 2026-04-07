from __future__ import annotations

from gossamer.auth_deps import basic_auth_ok
from gossamer.config import Settings


def test_basic_auth_ok_when_disabled() -> None:
    s = Settings(auth_disabled=True, auth_username="a", auth_password="b")
    assert basic_auth_ok(s, None, None) is True
    assert basic_auth_ok(s, "wrong", "wrong") is True


def test_basic_auth_ok_requires_credentials_when_enabled() -> None:
    s = Settings(auth_disabled=False, auth_username="gossamer", auth_password="secret")
    assert basic_auth_ok(s, None, None) is False
    assert basic_auth_ok(s, "gossamer", None) is False


def test_basic_auth_ok_validates_secrets() -> None:
    s = Settings(auth_disabled=False, auth_username="u1", auth_password="p1")
    assert basic_auth_ok(s, "u1", "p1") is True
    assert basic_auth_ok(s, "u1", "p2") is False
    assert basic_auth_ok(s, "u2", "p1") is False


def test_basic_auth_timing_safe_wrong_password_same_length() -> None:
    s = Settings(auth_disabled=False, auth_username="user", auth_password="aaaa")
    assert basic_auth_ok(s, "user", "aaab") is False
