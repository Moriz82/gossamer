from gossamer.scope import host_allowed


def test_scope_empty_allows_all() -> None:
    assert host_allowed("anything.test", []) is True


def test_scope_suffix() -> None:
    assert host_allowed("app.example.com", ["example.com"]) is True
    assert host_allowed("evil.com", ["example.com"]) is False
