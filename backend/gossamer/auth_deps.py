from __future__ import annotations

import secrets

from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPBasic, HTTPBasicCredentials

from gossamer.config import Settings, get_settings
from gossamer.runtime_settings import get_effective_auth_credentials

_http_basic = HTTPBasic(auto_error=False)


def basic_auth_ok(settings: Settings, username: str | None, password: str | None) -> bool:
    if settings.auth_disabled:
        return True
    if username is None or password is None:
        return False
    eu, ep = get_effective_auth_credentials(settings)
    u_ok = secrets.compare_digest(username, eu)
    p_ok = secrets.compare_digest(password, ep)
    return u_ok and p_ok


def require_auth(
    credentials: HTTPBasicCredentials | None = Depends(_http_basic),
    settings: Settings = Depends(get_settings),
) -> None:
    user = credentials.username if credentials else None
    pw = credentials.password if credentials else None
    if basic_auth_ok(settings, user, pw):
        return
    detail = "Not authenticated" if user is None or pw is None else "Invalid credentials"
    raise HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail=detail,
        headers={"WWW-Authenticate": 'Basic realm="Gossamer"'},
    )
