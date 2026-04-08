"""Generic scanner execution engine."""
from __future__ import annotations

import logging
import re
import subprocess
import tempfile
import time
from pathlib import Path
from typing import Any, Callable

from gossamer.plugin_store import _load_registry, get_binary_path

logger = logging.getLogger(__name__)

_active_processes: dict[str, subprocess.Popen] = {}

# ── Output classification helpers ──

_FFUF_PROGRESS_RE = re.compile(
    r"::\s*Progress:\s*\[(\d+)/(\d+)\].*?(\d+)\s*req/sec.*?Duration:\s*\[([^\]]+)\](?:.*?Errors:\s*(\d+))?"
)
_FFUF_MATCH_RE = re.compile(
    r"\[Status:\s*(\d+),\s*Size:\s*(\d+),\s*Words:\s*(\d+),\s*Lines:\s*(\d+)"
)
_FEROX_PROGRESS_RE = re.compile(r"(\d+)\s*/\s*(\d+)\s*-.*?(\d+)\s*/s")


def _classify_line(line: str) -> str:
    """Classify an output line: 'banner', 'progress', 'match', or 'other'."""
    # ffuf banner / config echo / separators
    if line.startswith(("/'___", "/\\ \\", "\\ \\", "\\/_/", "v2.", "___")) or \
       (line.startswith("::") and "Progress:" not in line):
        return "banner"
    if ":: Progress:" in line:
        return "progress"
    # feroxbuster noise
    if line.startswith("───") or (line.startswith("│") and "/" in line[:40]):
        return "progress"
    if "\r" in line and ("Progress" in line or "%" in line):
        return "progress"
    # Match result lines
    if _FFUF_MATCH_RE.search(line):
        return "match"
    return "other"


def _parse_progress(line: str) -> str:
    """Extract clean summary from a progress-bar line."""
    m = _FFUF_PROGRESS_RE.search(line)
    if m:
        cur, total, rps, dur, errs = m.group(1), m.group(2), m.group(3), m.group(4), m.group(5)
        pct = int(int(cur) / max(int(total), 1) * 100)
        s = f"[{cur}/{total}] {pct}% | {rps} req/s | {dur}"
        if errs and int(errs) > 0:
            s += f" | {errs} errors"
        return s
    m = _FEROX_PROGRESS_RE.search(line)
    if m:
        return f"[{m.group(1)}/{m.group(2)}] {m.group(3)}/s"
    return line[:120]


class _MatchTracker:
    """Tracks match results to detect false-positive patterns and throttle output."""

    def __init__(self) -> None:
        self.size_counts: dict[int, int] = {}
        self.total = 0
        self.suggestion_sent = False
        self.last_emit = 0.0

    def record(self, line: str) -> str | None:
        """Record a match line. Returns a display string or None to suppress."""
        self.total += 1
        m = _FFUF_MATCH_RE.search(line)
        if m:
            size = int(m.group(2))
            self.size_counts[size] = self.size_counts.get(size, 0) + 1

        now = time.time()
        # After 10+ matches with same size, suggest a filter (once)
        if not self.suggestion_sent:
            for sz, cnt in self.size_counts.items():
                if cnt >= 10:
                    self.suggestion_sent = True
                    return (
                        f"⚠ {cnt}+ matches with size {sz} — likely false positives. "
                        f"Set filter size to {sz} to exclude them."
                    )

        # Throttle match output: max 1 per second
        if now - self.last_emit < 1.0:
            return None
        self.last_emit = now
        # Clean up the line — strip the word before [Status:
        return line[:160]


def run_scanner(
    plugin_id: str,
    targets: list[str],
    *,
    progress_cb: Callable[[dict[str, Any]], None] | None = None,
    extra_args: list[str] | None = None,
    timeout: int = 600,
    raw_output: bool = False,
) -> dict[str, Any]:
    """Run a scanner binary and return results path for ingestion."""
    binary = get_binary_path(plugin_id)
    if not binary:
        return {"ok": False, "error": f"Binary not found for {plugin_id}. Install it first."}

    registry = _load_registry()
    plugin = next((p for p in registry if p.id == plugin_id), None)
    if not plugin:
        return {"ok": False, "error": f"Unknown plugin: {plugin_id}"}

    # Write targets to temp file
    targets_file = tempfile.NamedTemporaryFile(mode="w", suffix=".txt", delete=False)
    targets_file.write("\n".join(targets))
    targets_file.close()

    # Build output file path (ffuf outputs proper JSON, others use JSONL)
    output_suffix = ".json" if plugin_id == "ffuf" else ".jsonl"
    output_file = tempfile.NamedTemporaryFile(suffix=output_suffix, delete=False)
    output_file.close()

    # Build command based on scanner type
    cmd = [binary]
    cmd.extend(plugin.default_args)

    # Extract wordlist from extra_args if present (for fuzzers)
    wordlist_path = None
    filtered_extra: list[str] = []
    if extra_args:
        skip_next = False
        for i, arg in enumerate(extra_args):
            if skip_next:
                skip_next = False
                continue
            if arg == "-w" and i + 1 < len(extra_args):
                wordlist_path = extra_args[i + 1]
                skip_next = True
            else:
                filtered_extra.append(arg)

    # Whether to capture stdout lines into the output file (for tools that
    # emit JSON on stdout instead of writing to -o, e.g. feroxbuster --json)
    capture_stdout = False

    if plugin_id == "nuclei":
        cmd.extend(["-l", targets_file.name, "-o", output_file.name])
    elif plugin_id == "ffuf":
        # ffuf: -u URL/FUZZ -w wordlist -o output -of json
        if not wordlist_path:
            return {"ok": False, "error": "ffuf requires a wordlist (-w). Install SecLists or assign a wordlist."}
        base = targets[0] if targets else "http://localhost"
        url = base.rstrip("/") + "/FUZZ"
        cmd.extend(["-u", url, "-w", wordlist_path, "-o", output_file.name, "-of", "json"])
    elif plugin_id == "feroxbuster":
        # feroxbuster --json emits JSON lines to stdout; we capture them to file
        base = targets[0] if targets else "http://localhost"
        cmd.extend(["-u", base])
        if wordlist_path:
            cmd.extend(["-w", wordlist_path])
        capture_stdout = True
    elif plugin_id == "trivy":
        cmd.extend([targets[0] if targets else "."])
        cmd.extend(["-o", output_file.name])
    elif plugin_id == "gitleaks":
        cmd.extend(["--source", targets[0] if targets else ".", "-r", output_file.name])
    elif plugin_id == "grype":
        cmd.extend([targets[0] if targets else "."])
        cmd.extend(["-o", "json", "--file", output_file.name])
    else:
        cmd.extend(["-l", targets_file.name, "-o", output_file.name])

    if filtered_extra:
        cmd.extend(filtered_extra)

    full_cmd = " ".join(cmd)
    logger.info("Running: %s", full_cmd)

    if progress_cb:
        progress_cb({"type": "progress", "phase": "starting", "command": full_cmd})

    output_path = Path(output_file.name)
    out_fh = None
    try:
        proc = subprocess.Popen(
            cmd, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True,
        )
        _active_processes[plugin_id] = proc

        start_time = time.time()
        lines_seen = 0
        last_output = ""
        last_progress_cb = 0.0
        match_tracker = _MatchTracker()

        # For stdout-capture tools, write stdout lines into the output file
        if capture_stdout:
            out_fh = open(output_path, "w")

        while proc.poll() is None:
            if proc.stdout:
                line = proc.stdout.readline()
                stripped = line.strip()
                if stripped:
                    lines_seen += 1
                    last_output = stripped[:200]
                    if out_fh:
                        out_fh.write(line)
                    if progress_cb:
                        now = time.time()
                        elapsed = int(now - start_time)

                        if raw_output:
                            # TTY mode: forward every line unmodified
                            progress_cb({
                                "type": "progress", "phase": "scanning",
                                "lines_processed": lines_seen,
                                "elapsed_seconds": elapsed,
                                "output": stripped[:500],
                            })
                        else:
                            # Pipeline mode: classify and throttle
                            kind = _classify_line(stripped)
                            if kind == "banner":
                                pass
                            elif kind == "progress":
                                if (now - last_progress_cb) >= 3.0:
                                    last_progress_cb = now
                                    progress_cb({
                                        "type": "progress", "phase": "scanning",
                                        "lines_processed": lines_seen,
                                        "elapsed_seconds": elapsed,
                                        "output": _parse_progress(stripped),
                                    })
                            elif kind == "match":
                                display = match_tracker.record(stripped)
                                if display:
                                    progress_cb({
                                        "type": "progress", "phase": "scanning",
                                        "lines_processed": lines_seen,
                                        "elapsed_seconds": elapsed,
                                        "output": display,
                                    })
                            else:
                                progress_cb({
                                    "type": "progress", "phase": "scanning",
                                    "lines_processed": lines_seen,
                                    "elapsed_seconds": elapsed,
                                    "output": stripped[:200],
                                })
            if time.time() - start_time > timeout:
                proc.kill()
                if out_fh:
                    out_fh.close()
                return {"ok": False, "error": f"Scanner timed out after {timeout}s"}

        # Read any remaining output
        if proc.stdout:
            for line in proc.stdout:
                stripped = line.strip()
                if stripped:
                    lines_seen += 1
                    last_output = stripped[:200]
                    if out_fh:
                        out_fh.write(line)

        if out_fh:
            out_fh.close()
            out_fh = None

        rc = proc.returncode
        _active_processes.pop(plugin_id, None)
        elapsed = int(time.time() - start_time)

        if progress_cb:
            progress_cb({
                "type": "progress",
                "phase": "finished",
                "exit_code": rc,
                "elapsed_seconds": elapsed,
                "lines_total": lines_seen,
            })

        # Check if output file has content
        if not output_path.exists() or output_path.stat().st_size == 0:
            return {
                "ok": rc == 0,
                "exit_code": rc,
                "elapsed_seconds": elapsed,
                "output_file": None,
                "last_output": last_output,
                "lines_total": lines_seen,
                "ingestor": plugin.ingestor,
                "command": full_cmd,
            }

        return {
            "ok": True,
            "exit_code": rc,
            "elapsed_seconds": elapsed,
            "output_file": output_file.name,
            "output_size": output_path.stat().st_size,
            "lines_total": lines_seen,
            "ingestor": plugin.ingestor,
            "command": full_cmd,
        }
    except FileNotFoundError:
        _active_processes.pop(plugin_id, None)
        if out_fh:
            out_fh.close()
        output_path.unlink(missing_ok=True)
        return {"ok": False, "error": f"Binary not found: {binary}"}
    except Exception as e:
        _active_processes.pop(plugin_id, None)
        if out_fh:
            out_fh.close()
        output_path.unlink(missing_ok=True)
        return {"ok": False, "error": str(e)}
    finally:
        Path(targets_file.name).unlink(missing_ok=True)


def stop_scanner(plugin_id: str) -> dict[str, Any]:
    """Stop a running scanner process."""
    proc = _active_processes.get(plugin_id)
    if proc and proc.poll() is None:
        proc.kill()
        _active_processes.pop(plugin_id, None)
        return {"ok": True, "message": "Scanner stopped"}
    return {"ok": False, "error": "No running scanner found"}
