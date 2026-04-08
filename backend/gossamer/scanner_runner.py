"""Generic scanner execution engine."""
from __future__ import annotations

import logging
import subprocess
import tempfile
import time
from pathlib import Path
from typing import Any, Callable

from gossamer.plugin_store import _load_registry, get_binary_path

logger = logging.getLogger(__name__)

_active_processes: dict[str, subprocess.Popen] = {}


def run_scanner(
    plugin_id: str,
    targets: list[str],
    *,
    progress_cb: Callable[[dict[str, Any]], None] | None = None,
    extra_args: list[str] | None = None,
    timeout: int = 600,
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

    # Build output file path
    output_file = tempfile.NamedTemporaryFile(suffix=".jsonl", delete=False)
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

    if plugin_id == "nuclei":
        cmd.extend(["-l", targets_file.name, "-o", output_file.name, "-jsonl"])
    elif plugin_id == "ffuf":
        # ffuf needs: -u URL/FUZZ -w wordlist for each target
        # Run against first target with FUZZ keyword
        if wordlist_path:
            base = targets[0] if targets else "http://localhost"
            url = base.rstrip("/") + "/FUZZ"
            cmd.extend(["-u", url, "-w", wordlist_path, "-o", output_file.name, "-of", "json"])
        else:
            cmd.extend(["-l", targets_file.name, "-o", output_file.name])
    elif plugin_id == "feroxbuster":
        base = targets[0] if targets else "http://localhost"
        cmd.extend(["-u", base, "-o", output_file.name])
        if wordlist_path:
            cmd.extend(["-w", wordlist_path])
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

    if progress_cb:
        progress_cb({"type": "progress", "phase": "starting", "command": " ".join(cmd[:3]) + "..."})

    output_path = Path(output_file.name)
    try:
        proc = subprocess.Popen(
            cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True,
        )
        _active_processes[plugin_id] = proc

        start_time = time.time()
        lines_seen = 0

        # Stream stdout for progress
        while proc.poll() is None:
            if proc.stdout:
                line = proc.stdout.readline()
                if line.strip():
                    lines_seen += 1
                    if progress_cb and lines_seen % 5 == 0:
                        elapsed = int(time.time() - start_time)
                        progress_cb({
                            "type": "progress",
                            "phase": "scanning",
                            "lines_processed": lines_seen,
                            "elapsed_seconds": elapsed,
                        })
            if time.time() - start_time > timeout:
                proc.kill()
                return {"ok": False, "error": f"Scanner timed out after {timeout}s"}

        rc = proc.returncode
        _active_processes.pop(plugin_id, None)

        elapsed = int(time.time() - start_time)

        if progress_cb:
            progress_cb({
                "type": "progress",
                "phase": "complete",
                "exit_code": rc,
                "elapsed_seconds": elapsed,
                "output_file": output_file.name,
            })

        # Check if output file has content
        if not output_path.exists() or output_path.stat().st_size == 0:
            stderr = proc.stderr.read() if proc.stderr else ""
            output_path.unlink(missing_ok=True)
            return {
                "ok": rc == 0,
                "exit_code": rc,
                "elapsed_seconds": elapsed,
                "output_file": None,
                "stderr": stderr[:500] if stderr else None,
                "ingestor": plugin.ingestor,
            }

        return {
            "ok": True,
            "exit_code": rc,
            "elapsed_seconds": elapsed,
            "output_file": output_file.name,
            "output_size": output_path.stat().st_size,
            "ingestor": plugin.ingestor,
        }
    except FileNotFoundError:
        _active_processes.pop(plugin_id, None)
        output_path.unlink(missing_ok=True)
        return {"ok": False, "error": f"Binary not found: {binary}"}
    except Exception as e:
        _active_processes.pop(plugin_id, None)
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
