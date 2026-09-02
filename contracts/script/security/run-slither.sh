#!/usr/bin/env bash
#
# Phase 5 P5-017 — Slither static analysis baseline.
#
# Runs Slither against each vendored hook submodule and dumps:
#   - raw human-readable summary  → docs/security/slither/<hook>.txt
#   - JSON detector output         → docs/security/slither/<hook>.json
#   - severity counts               → stdout (echoed for the harness summary)
#
# Run from repo root:
#   ./contracts/script/security/run-slither.sh
#
# Prereqs:
#   pip install --user slither-analyzer solc-select
#   solc-select install 0.8.26 && solc-select use 0.8.26
#   git submodule update --init --recursive
#
# This script is intentionally ignorant of triage — every finding goes
# raw to docs/security/slither/. Triage + classification into
# docs/security/findings.md is a separate task (P5-018+).

set -euo pipefail

OUT_DIR="docs/security/slither"
HOOKS=(stable-protection dynamic-fee rwa-gate limit-orders)

mkdir -p "$OUT_DIR"

for hook in "${HOOKS[@]}"; do
  echo ""
  echo "═══ slither: $hook ═══"
  pushd "contracts/hooks/$hook" > /dev/null

  # Single Slither pass: detector JSON. `--no-fail-pedantic` because
  # Slither exits non-zero on any finding, which would abort `set -e`.
  # Some hooks may fail to compile — capture stderr but don't abort the loop.
  slither . \
    --json "../../../$OUT_DIR/$hook.json" \
    --no-fail-pedantic \
    > "../../../$OUT_DIR/$hook.txt" 2>&1 || true

  # Severity counts read from the JSON (one source of truth).
  python3 -c "
import json, sys
try:
    d = json.load(open('../../../$OUT_DIR/$hook.json'))
    det = d.get('results', {}).get('detectors', [])
    by = {}
    for f in det: by[f.get('impact','?')] = by.get(f.get('impact','?'),0)+1
    print(f'  total findings: {len(det)}  high: {by.get(\"High\",0)}  medium: {by.get(\"Medium\",0)}  low: {by.get(\"Low\",0)}  info: {by.get(\"Informational\",0)}')
except Exception as e:
    print(f'  (JSON parse failed: {e})')
" || echo "  (python summary failed)"

  popd > /dev/null
done

echo ""
echo "═══ done ═══"
echo "Per-hook outputs:"
ls -1 "$OUT_DIR"
