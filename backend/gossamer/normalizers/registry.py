from __future__ import annotations

from typing import Any

from gossamer.normalizers.collapse_trailing_slash import CollapseTrailingSlash
from gossamer.normalizers.lowercase_host import LowercaseHost
from gossamer.normalizers.strip_utm import StripUtm

_NORMALIZER_REGISTRY: dict[str, Any] = {
    LowercaseHost.name: LowercaseHost(),
    CollapseTrailingSlash.name: CollapseTrailingSlash(),
    StripUtm.name: StripUtm(),
}


def get_step(name: str) -> Any | None:
    return _NORMALIZER_REGISTRY.get(name)


def build_chain(order: list[str]) -> list[Any]:
    steps = []
    for name in order:
        s = get_step(name)
        if s is not None:
            steps.append(s)
    return steps


def register_normalizer(step: Any) -> None:
    _NORMALIZER_REGISTRY[step.name] = step


def all_normalizer_defs() -> list[dict[str, str]]:
    out: list[dict[str, str]] = []
    for name, step in sorted(_NORMALIZER_REGISTRY.items(), key=lambda x: x[0]):
        cls = step.__class__
        doc = (cls.__doc__ or "").strip().split("\n")[0] if cls.__doc__ else ""
        out.append({"name": name, "description": doc or f"Normalizer: {name}"})
    return out
