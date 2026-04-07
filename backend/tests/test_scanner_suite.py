from __future__ import annotations

import json
from pathlib import Path

from gossamer.config import Settings
from gossamer.ingestors.registry import get_ingestor
from gossamer.pipeline import run_ingest


def _assert_findings(batch, min_findings: int = 1) -> None:
    assert sum(1 for n in batch.nodes if n.kind == "Finding") >= min_findings


def test_sarif_json_ingestor(tmp_path: Path) -> None:
    doc = {
        "version": "2.1.0",
        "$schema": "https://schemastore.org/sarif-2.1.0.json",
        "runs": [
            {
                "tool": {"driver": {"name": "testtool"}},
                "results": [
                    {
                        "ruleId": "RULE-1",
                        "level": "error",
                        "message": {"text": "Bad thing"},
                        "locations": [
                            {
                                "physicalLocation": {
                                    "artifactLocation": {"uri": "https://sarif.test/path"}
                                }
                            }
                        ],
                    }
                ],
            }
        ],
    }
    p = tmp_path / "out.sarif"
    p.write_text(json.dumps(doc), encoding="utf-8")
    assert get_ingestor(p).name == "sarif_json"
    batch = run_ingest(p, "s", None, Settings())
    _assert_findings(batch)


def test_trivy_json_ingestor(tmp_path: Path) -> None:
    doc = {
        "SchemaVersion": 2,
        "ArtifactName": "alpine:3",
        "Results": [
            {
                "Target": "alpine:3",
                "Vulnerabilities": [
                    {
                        "VulnerabilityID": "CVE-2099-1",
                        "PkgName": "openssl",
                        "InstalledVersion": "1.1",
                        "Severity": "HIGH",
                        "Title": "openssl issue",
                    }
                ],
            }
        ],
    }
    p = tmp_path / "trivy.json"
    p.write_text(json.dumps(doc), encoding="utf-8")
    assert get_ingestor(p).name == "trivy_json"
    batch = run_ingest(p, "t", None, Settings())
    _assert_findings(batch)


def test_grype_json_ingestor(tmp_path: Path) -> None:
    doc = {
        "matches": [
            {
                "artifact": {"name": "libx", "version": "1.0", "type": "apk"},
                "vulnerability": {
                    "id": "CVE-2099-2",
                    "severity": "High",
                    "urls": ["https://nvd.nist.gov/"],
                },
            }
        ]
    }
    p = tmp_path / "g.json"
    p.write_text(json.dumps(doc), encoding="utf-8")
    assert get_ingestor(p).name == "grype_json"
    batch = run_ingest(p, "g", None, Settings())
    _assert_findings(batch)


def test_bandit_and_semgrep_roundtrip(tmp_path: Path) -> None:
    bandit = {
        "results": [
            {
                "filename": "/app/x.py",
                "test_id": "B102",
                "issue_text": "exec",
                "issue_severity": "HIGH",
                "line_number": 10,
            }
        ],
        "metrics": {},
    }
    p1 = tmp_path / "b.json"
    p1.write_text(json.dumps(bandit), encoding="utf-8")
    assert get_ingestor(p1).name == "bandit_json"
    _assert_findings(run_ingest(p1, "b", None, Settings()))

    semgrep = {
        "version": "1.0.0",
        "errors": [],
        "paths": {},
        "results": [
            {
                "check_id": "python.lang.eval",
                "path": "src/y.py",
                "start": {"line": 3},
                "extra": {"message": "avoid eval", "severity": "ERROR"},
            }
        ],
    }
    p2 = tmp_path / "sg.json"
    p2.write_text(json.dumps(semgrep), encoding="utf-8")
    assert get_ingestor(p2).name == "semgrep_json"
    _assert_findings(run_ingest(p2, "s", None, Settings()))


def test_trufflehog_gitleaks_npm_pip(tmp_path: Path) -> None:
    th = tmp_path / "th.jsonl"
    th.write_text(
        json.dumps(
            {
                "DetectorName": "AWS",
                "Raw": "AKIA...",
                "Verified": False,
                "SourceMetadata": {"Data": {"Filesystem": {"file": "/src/a.env"}}},
            }
        )
        + "\n",
        encoding="utf-8",
    )
    assert get_ingestor(th).name == "trufflehog_json"
    _assert_findings(run_ingest(th, "th", None, Settings()))

    gl = tmp_path / "gl.json"
    gl.write_text(
        json.dumps(
            [
                {
                    "RuleID": "generic-api-key",
                    "Description": "key",
                    "StartLine": "1",
                    "File": "config.yml",
                    "Secret": "x",
                }
            ]
        ),
        encoding="utf-8",
    )
    assert get_ingestor(gl).name == "gitleaks_json"
    _assert_findings(run_ingest(gl, "gl", None, Settings()))

    npm = {
        "auditReportVersion": 2,
        "vulnerabilities": {
            "lodash": {
                "name": "lodash",
                "severity": "high",
                "via": [{"source": 1, "title": "Prototype pollution", "url": "https://npmjs.com/"}],
            }
        },
    }
    pn = tmp_path / "npm.json"
    pn.write_text(json.dumps(npm), encoding="utf-8")
    assert get_ingestor(pn).name == "npm_audit_json"
    _assert_findings(run_ingest(pn, "n", None, Settings()))

    pip = [
        {
            "name": "requests",
            "version": "2.0",
            "vuln_id": "GHSA-xxxx",
            "fix_versions": ["2.32.0"],
        }
    ]
    pp = tmp_path / "pip.json"
    pp.write_text(json.dumps(pip), encoding="utf-8")
    assert get_ingestor(pp).name == "pip_audit_json"
    _assert_findings(run_ingest(pp, "p", None, Settings()))


def test_checkov_wpscan_dependency_check(tmp_path: Path) -> None:
    ck = {
        "check_type": "terraform",
        "results": {
            "failed_checks": [
                {
                    "check_id": "CKV_AWS_1",
                    "check_name": "Public access",
                    "file_path": "/m/main.tf",
                    "severity": "HIGH",
                }
            ]
        },
    }
    p = tmp_path / "ck.json"
    p.write_text(json.dumps(ck), encoding="utf-8")
    assert get_ingestor(p).name == "checkov_json"
    _assert_findings(run_ingest(p, "c", None, Settings()))

    wp = {
        "target_url": "https://wp.test/",
        "plugins": {
            "jetpack": {
                "version": {"number": "1"},
                "vulnerabilities": [{"title": "Jetpack XSS", "fixed_in": "2.0"}],
            }
        },
    }
    p2 = tmp_path / "wp.json"
    p2.write_text(json.dumps(wp), encoding="utf-8")
    assert get_ingestor(p2).name == "wpscan_json"
    _assert_findings(run_ingest(p2, "w", None, Settings()))

    dc = {
        "dependencies": [
            {
                "fileName": "foo.jar",
                "vulnerabilities": [
                    {"name": "CVE-1", "severity": "HIGH", "description": "bad"},
                ],
            }
        ]
    }
    p3 = tmp_path / "dc.json"
    p3.write_text(json.dumps(dc), encoding="utf-8")
    assert get_ingestor(p3).name == "dependency_check_json"
    _assert_findings(run_ingest(p3, "d", None, Settings()))


def test_snyk_test_json(tmp_path: Path) -> None:
    doc = {
        "vulnerabilities": [
            {
                "id": "SNYK-JS-1",
                "title": "Prototype pollution",
                "packageName": "minimist",
                "severity": "high",
                "references": [{"url": "https://security.snyk.io/"}],
            }
        ],
        "packageManager": "npm",
    }
    p = tmp_path / "snyk.json"
    p.write_text(json.dumps(doc), encoding="utf-8")
    assert get_ingestor(p).name == "snyk_test_json"
    _assert_findings(run_ingest(p, "sy", None, Settings()))
