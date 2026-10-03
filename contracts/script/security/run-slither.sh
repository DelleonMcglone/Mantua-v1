#!/usr/bin/env bash
#
# Phase 5 P5-017 — Slither static analysis baseline.
#
# Runs Slither against the first-party markets + dynamic-market
# contracts and dumps:
#   - raw human-readable summary  → docs/security/slither/markets-dynamic-market.txt
#   - JSON detector output         → docs/security/slither/markets-dynamic-market.json
#   - severity counts               → stdout (echoed for the harness summary)
#
# Run from repo root:
#   ./contracts/script/security/run-slither.sh
#
# Prereqs:
#   pip install --user slither-analyzer solc-select
#   solc-select install 0.8.26 && solc-select use 0.8.26
#
# This script is intentionally ignorant of triage — every finding goes
# raw to docs/security/slither/. Triage + classification into
# docs/security/findings.md is a separate task (P5-018+).

set -euo pipefail

OUT_DIR="docs/security/slither"
mkdir -p "$OUT_DIR"

# ─── Task 045 (P-013): first-party markets + dynamic-market contracts ───
#
# Slither runs against the Foundry project root using the forge build
# artifacts. filter-paths keeps the findings to first-party sources
# (lib deps, tests and scripts are out of scope for this pass).
echo ""
echo "═══ slither: markets + dynamic-market (first-party) ═══"
pushd contracts > /dev/null
slither . \
  --foundry-out-directory out \
  --filter-paths "lib/|test/|script/" \
  --no-fail-pedantic \
  --json "../$OUT_DIR/markets-dynamic-market.json" \
  > "../$OUT_DIR/markets-dynamic-market.txt" 2>&1 || true

python3 -c "
import json
try:
    d = json.load(open('../$OUT_DIR/markets-dynamic-market.json'))
    det = d.get('results', {}).get('detectors', [])
    by = {}
    for f in det: by[f.get('impact','?')] = by.get(f.get('impact','?'),0)+1
    print(f'  total findings: {len(det)}  high: {by.get(\"High\",0)}  medium: {by.get(\"Medium\",0)}  low: {by.get(\"Low\",0)}  info: {by.get(\"Informational\",0)}')
except Exception as e:
    print(f'  (JSON parse failed: {e})')
" || echo "  (python summary failed)"
popd > /dev/null

echo ""
echo "═══ done ═══"
echo "Per-target outputs:"
ls -1 "$OUT_DIR"
