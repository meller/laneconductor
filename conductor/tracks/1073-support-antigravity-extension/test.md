# Test: Track 1073 — Support Antigravity Extension

## Test Cases

### TC-1: CLI Setup Symlinks Creation
- **Action**: Run `node bin/lc.mjs setup` (or `lc setup`) in a fresh test directory.
- **Verification**:
  - Check that `.claude/skills/laneconductor` exists and points to the correct installation directory.
  - Check that `.agents/skills/laneconductor` exists and points to the correct installation directory.
  - Check that `.agents/rules/laneconductor.md` exists and points to the global rule.

### TC-2: AI-Native Setup Instructions Sync
- **Action**: Grep check `SKILL.md` to ensure both `.claude/skills/` and `.agents/skills/` paths are updated.
- **Verification**:
  - Assert that lines referencing symlink targeting contain instructions to create both directories and link.

## Verification Commands
```bash
# Verify skill paths in SKILL.md
grep -n "TARGET_AG_SKILL" .claude/skills/laneconductor/SKILL.md || grep -n ".agents/skills" .claude/skills/laneconductor/SKILL.md

# Verify setup run
mkdir -p .test-setup-sandbox
cd .test-setup-sandbox
node ../bin/lc.mjs setup --mode local-fs
ls -la .claude/skills/
ls -la .agents/skills/
ls -la .agents/rules/
cd ..
rm -rf .test-setup-sandbox
```
