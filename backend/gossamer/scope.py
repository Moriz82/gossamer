from __future__ import annotations


def host_allowed(hostname: str, scope_hosts: list[str]) -> bool:
    if not scope_hosts:
        return True
    h = hostname.strip().lower().rstrip(".")
    for rule in scope_hosts:
        r = rule.strip().lower().rstrip(".")
        if not r:
            continue
        if h == r or h.endswith("." + r):
            return True
    return False
