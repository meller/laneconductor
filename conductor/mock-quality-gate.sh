#!/bin/bash
# conductor/mock-quality-gate.sh
# Automated quality gate checks for the LaneConductor project.
# Referenced by conductor/quality-gate.md as the check runner.
# Usage: ./conductor/mock-quality-gate.sh
# Exit: 0 = all checks passed, 1 = one or more checks failed.

set -euo pipefail
PASS=0
FAIL=0

check() {
  local label="$1"
  local result="$2"  # "pass" or "fail"
  local note="${3:-}"
  if [ "$result" = "pass" ]; then
    echo "  ✅ $label${note:+ — $note}"
    PASS=$((PASS + 1))
  else
    echo "  ❌ $label${note:+ — $note}"
    FAIL=$((FAIL + 1))
  fi
}

echo "🔍 LaneConductor Quality Gate"
echo "==============================="

# ── Syntax checks ─────────────────────────────────────────────────────────────
echo ""
echo "## Syntax"

for f in conductor/laneconductor.sync.mjs ui/server/index.mjs ui/server/wsBroadcast.mjs; do
  if [ -f "$f" ]; then
    if node --check "$f" 2>/dev/null; then
      check "node --check $f" "pass"
    else
      check "node --check $f" "fail" "syntax error"
    fi
  else
    check "node --check $f" "fail" "file not found"
  fi
done

# ── Critical file existence ────────────────────────────────────────────────────
echo ""
echo "## Critical Files"

CRITICAL_FILES=(
  ".laneconductor.json"
  "conductor/laneconductor.sync.mjs"
  "conductor/lc-verify.sh"
  "conductor/workflow.md"
  "conductor/quality-gate.md"
  "ui/server/index.mjs"
  "Makefile"
)

for f in "${CRITICAL_FILES[@]}"; do
  if [ -f "$f" ]; then
    check "$f exists" "pass"
  else
    check "$f exists" "fail" "missing"
  fi
done

# ── Config validation ──────────────────────────────────────────────────────────
echo ""
echo "## Config"

if node -e "
  const c = require('./.laneconductor.json');
  if (!c.project.id) throw new Error('project.id missing');
  if (!c.db.host)    throw new Error('db.host missing');
  if (!c.db.name)    throw new Error('db.name missing');
  process.exit(0);
" 2>/dev/null; then
  check ".laneconductor.json valid" "pass"
else
  check ".laneconductor.json valid" "fail" "invalid JSON or missing required fields"
fi

# ── DB connectivity ────────────────────────────────────────────────────────────
echo ""
echo "## Database"

DB_OK=$(node -e "
const { Client } = require('pg');
const cfg = require('./.laneconductor.json');
const c = new Client({ host: cfg.db.host, port: cfg.db.port, database: cfg.db.name, user: cfg.db.user, password: cfg.db.password });
c.connect().then(() => c.query('SELECT 1')).then(() => { process.stdout.write('ok'); c.end(); }).catch(e => { process.stdout.write('err:' + e.message); c.end(); });
" 2>/dev/null)

if [ "$DB_OK" = "ok" ]; then
  check "Postgres connectivity" "pass"
else
  check "Postgres connectivity" "fail" "$DB_OK"
fi

# ── npm audit (security) ───────────────────────────────────────────────────────
echo ""
echo "## Security"

# Run audit in ui/ (where node_modules live)
if command -v npm &>/dev/null && [ -f "ui/package.json" ]; then
  AUDIT_OUT=$(cd ui && npm audit --audit-level=high --json 2>/dev/null || true)
  HIGH=$(echo "$AUDIT_OUT" | node -e "
    let d=''; process.stdin.on('data',c=>d+=c).on('end',()=>{
      try { const j=JSON.parse(d); process.stdout.write(String(j.metadata?.vulnerabilities?.high ?? 0)); }
      catch { process.stdout.write('0'); }
    });
  " 2>/dev/null)
  CRITICAL=$(echo "$AUDIT_OUT" | node -e "
    let d=''; process.stdin.on('data',c=>d+=c).on('end',()=>{
      try { const j=JSON.parse(d); process.stdout.write(String(j.metadata?.vulnerabilities?.critical ?? 0)); }
      catch { process.stdout.write('0'); }
    });
  " 2>/dev/null)
  if [ "${HIGH:-0}" = "0" ] && [ "${CRITICAL:-0}" = "0" ]; then
    check "npm audit (ui/) — no high/critical vulns" "pass"
  else
    check "npm audit (ui/) — no high/critical vulns" "fail" "${HIGH:-0} high, ${CRITICAL:-0} critical"
  fi
else
  check "npm audit (ui/) — no high/critical vulns" "pass" "skipped (npm/package not found)"
fi

# ── Deployment Safety ────────────────────────────────────────────────────────
echo ""
echo "## Deployment Safety"

# 1. Check .gitignore for secrets patterns
GITIGNORE_PATTERNS=(".env" "*.tfvars" "*-key.json" ".vercel" "service-account*.json")
if [ -f ".gitignore" ]; then
  MISSING_PATTERNS=()
  for p in "${GITIGNORE_PATTERNS[@]}"; do
    if ! grep -q "$p" .gitignore; then
      MISSING_PATTERNS+=("$p")
    fi
  done
  if [ ${#MISSING_PATTERNS[@]} -eq 0 ]; then
    check ".gitignore contains secrets patterns" "pass"
  else
    check ".gitignore contains secrets patterns" "fail" "missing: ${MISSING_PATTERNS[*]}"
  fi
else
  check ".gitignore exists" "fail" "missing"
fi

# 2. Scan for hardcoded secrets (basic regex)
# Look for strings like API_KEY=..., SECRET=..., etc. in non-ignored files
SECRET_MATCHES=$(grep -rE "(API_KEY|SECRET|TOKEN|PASSWORD|PRIVATE_KEY)\s*[:=]\s*['\"][a-zA-Z0-9_\-]{10,}['\"]" . \
  --exclude-dir={node_modules,.git,ui/node_modules,dist,playwright-report} \
  --exclude={.env.example,package-lock.json,*.sql} || true)

if [ -z "$SECRET_MATCHES" ]; then
  check "No hardcoded secrets detected" "pass"
else
  check "No hardcoded secrets detected" "fail" "found $(echo "$SECRET_MATCHES" | wc -l) potential secrets"
fi

# 3. Context file consistency
if [ -f "conductor/deploy.json" ]; then
  if [ -f "conductor/deployment-stack.md" ]; then
    check "deployment-stack.md exists (required by deploy.json)" "pass"
  else
    check "deployment-stack.md exists (required by deploy.json)" "fail" "missing context file"
  fi
else
  check "deployment-stack.md stub (optional)" "pass" "$( [ -f "conductor/deployment-stack.md" ] && echo "exists" || echo "missing" )"
fi

# ── Summary ────────────────────────────────────────────────────────────────────
echo ""
echo "==============================="
echo "Results: ✅ $PASS passed  ❌ $FAIL failed"

if [ "$FAIL" -gt 0 ]; then
  echo "❌ Quality gate FAILED — $FAIL check(s) did not pass"
  exit 1
else
  echo "✅ Quality gate PASSED"
  exit 0
fi
