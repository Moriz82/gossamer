"""Tests for the scanner runner module."""
from __future__ import annotations

from pathlib import Path
from unittest.mock import MagicMock, patch

import pytest

from gossamer.scanner_runner import _active_processes, run_scanner, stop_scanner


def _make_mock_proc(*, returncode: int = 0, poll_sequence: list | None = None) -> MagicMock:
    """Build a mock subprocess.Popen with sensible defaults."""
    proc = MagicMock()
    proc.poll = MagicMock(side_effect=poll_sequence or [None, returncode])
    proc.stdout = MagicMock()
    proc.stdout.readline = MagicMock(return_value="")
    proc.stderr = MagicMock()
    proc.stderr.read = MagicMock(return_value="")
    proc.returncode = returncode
    return proc


# ── run_scanner ──────────────────────────────────────────────


def test_run_scanner_unknown_plugin() -> None:
    """Running a scanner for an unknown plugin returns an error."""
    result = run_scanner("nonexistent_tool_xyz", ["https://example.com"])
    assert result["ok"] is False
    assert "not found" in result["error"].lower() or "Unknown" in result["error"]


def test_run_scanner_no_binary() -> None:
    """Running a scanner that exists in registry but has no binary returns an error."""
    with patch("gossamer.scanner_runner.get_binary_path", return_value=None):
        result = run_scanner("nuclei", ["https://example.com"])
    assert result["ok"] is False
    assert "Binary not found" in result["error"] or "Install" in result["error"]


def test_run_scanner_builds_nuclei_command(tmp_path: Path) -> None:
    """Nuclei scanner builds the correct command with -l and -o flags."""
    fake_binary = tmp_path / "nuclei"
    fake_binary.write_text("#!/bin/sh\necho done")
    fake_binary.chmod(0o755)

    mock_proc = _make_mock_proc()
    captured_cmd = []

    def fake_popen(cmd, **kwargs):
        captured_cmd.extend(cmd)
        return mock_proc

    with patch("gossamer.scanner_runner.get_binary_path", return_value=str(fake_binary)), \
         patch("gossamer.scanner_runner.subprocess.Popen", side_effect=fake_popen):
        run_scanner("nuclei", ["https://example.com", "https://target.com"])

    assert str(fake_binary) in captured_cmd
    assert "-l" in captured_cmd
    assert "-o" in captured_cmd


def test_run_scanner_builds_trivy_command(tmp_path: Path) -> None:
    """Trivy scanner passes the target directly, not via -l flag."""
    fake_binary = tmp_path / "trivy"
    fake_binary.write_text("#!/bin/sh\necho done")
    fake_binary.chmod(0o755)

    mock_proc = _make_mock_proc()
    captured_cmd = []

    def fake_popen(cmd, **kwargs):
        captured_cmd.extend(cmd)
        return mock_proc

    with patch("gossamer.scanner_runner.get_binary_path", return_value=str(fake_binary)), \
         patch("gossamer.scanner_runner.subprocess.Popen", side_effect=fake_popen):
        run_scanner("trivy", ["/path/to/scan"])

    assert "/path/to/scan" in captured_cmd
    assert "-l" not in captured_cmd


def test_run_scanner_extra_args(tmp_path: Path) -> None:
    """Extra args are appended to the command."""
    fake_binary = tmp_path / "nuclei"
    fake_binary.write_text("#!/bin/sh\necho done")
    fake_binary.chmod(0o755)

    mock_proc = _make_mock_proc()
    captured_cmd = []

    def fake_popen(cmd, **kwargs):
        captured_cmd.extend(cmd)
        return mock_proc

    with patch("gossamer.scanner_runner.get_binary_path", return_value=str(fake_binary)), \
         patch("gossamer.scanner_runner.subprocess.Popen", side_effect=fake_popen):
        run_scanner("nuclei", ["https://example.com"], extra_args=["-severity", "critical"])

    assert "-severity" in captured_cmd
    assert "critical" in captured_cmd


def test_run_scanner_calls_progress_cb(tmp_path: Path) -> None:
    """Progress callback is called during scan execution."""
    fake_binary = tmp_path / "nuclei"
    fake_binary.write_text("#!/bin/sh\necho done")
    fake_binary.chmod(0o755)

    mock_proc = _make_mock_proc()
    events: list[dict] = []

    with patch("gossamer.scanner_runner.get_binary_path", return_value=str(fake_binary)), \
         patch("gossamer.scanner_runner.subprocess.Popen", return_value=mock_proc):
        run_scanner("nuclei", ["https://example.com"], progress_cb=lambda e: events.append(e))

    # At minimum we get the "starting" and "complete" progress events
    assert any(e.get("phase") == "starting" for e in events)
    assert any(e.get("phase") == "complete" for e in events)


def test_run_scanner_file_not_found(tmp_path: Path) -> None:
    """FileNotFoundError from Popen is handled gracefully."""
    with patch("gossamer.scanner_runner.get_binary_path", return_value="/nonexistent/binary"), \
         patch("gossamer.scanner_runner.subprocess.Popen", side_effect=FileNotFoundError("not found")):
        result = run_scanner("nuclei", ["https://example.com"])

    assert result["ok"] is False
    assert "not found" in result["error"].lower() or "Binary" in result["error"]


# ── stop_scanner ─────────────────────────────────────────────


def test_stop_scanner_no_active_process() -> None:
    """Stopping when no process is running returns an error."""
    result = stop_scanner("nuclei")
    assert result["ok"] is False
    assert "No running scanner" in result["error"]


def test_stop_scanner_kills_process() -> None:
    """Stopping an active process kills it and returns success."""
    mock_proc = MagicMock()
    mock_proc.poll = MagicMock(return_value=None)

    _active_processes["test_scanner"] = mock_proc
    try:
        result = stop_scanner("test_scanner")
        assert result["ok"] is True
        mock_proc.kill.assert_called_once()
        assert "test_scanner" not in _active_processes
    finally:
        _active_processes.pop("test_scanner", None)


def test_stop_scanner_already_finished() -> None:
    """Stopping a process that already exited returns an error."""
    mock_proc = MagicMock()
    mock_proc.poll = MagicMock(return_value=0)  # Already finished

    _active_processes["test_scanner"] = mock_proc
    try:
        result = stop_scanner("test_scanner")
        assert result["ok"] is False
    finally:
        _active_processes.pop("test_scanner", None)
