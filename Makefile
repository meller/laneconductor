SKILL_DIR  := $(shell pwd)/.claude/skills/laneconductor
RC_FILE    := $(HOME)/.laneconductorrc
UI_DIR     := $(shell pwd)/ui

.DEFAULT_GOAL := help

.PHONY: help install uninstall ui-install install-cli api-start api-stop api-log ui-start ui-stop ui-log ui-restart start-all stop-all

## Show available commands
help:
	@echo ""
	@echo "LaneConductor"
	@echo ""
	@echo "  make install       Install LaneConductor (run once after cloning)"
	@echo "  make install-cli   Install global 'lc' command"
	@echo "  make uninstall     Remove install marker"
	@echo ""
	@echo "  make api-start     Start Express API   → http://localhost:8091"
	@echo "  make api-stop      Stop Express API"
	@echo "  make api-log       Tail API log"
	@echo ""
	@echo "  make ui-start      Start Vite UI        → http://localhost:8090"
	@echo "  make ui-stop       Stop Vite UI"
	@echo "  make ui-log        Tail UI log"
	@echo "  make ui-restart    Restart Vite UI"
	@echo ""
	@echo "  make start-all     Start API + UI"
	@echo "  make stop-all      Stop  API + UI"
	@echo ""
	@echo "From a project repo, use: lc help"
	@echo ""

## Install LaneConductor (run once after cloning)
install: ui-install install-cli
	@echo "$(SKILL_DIR)" > $(RC_FILE)
	@echo "✅ Installed → $(RC_FILE)"
	@echo "   Skill path: $(SKILL_DIR)"
	@echo ""
	@echo "Next: open any project in Claude Code and run /laneconductor setup"
	@echo "      setup scaffold will symlink the skill into that project's .claude/skills/"

## Install global 'lc' command
install-cli:
	@echo "📦 Installing global 'lc' command to /usr/local/bin/lc..."
	@sudo ln -sf $(PWD)/bin/lc.mjs /usr/local/bin/lc
	@sudo chmod +x /usr/local/bin/lc
	@echo "✅ 'lc' command ready"

## Install UI dependencies
ui-install:
	@echo "📦 Installing UI dependencies..."
	@cd ui && npm install
	@echo "✅ UI ready"

## Start the Express API
api-start:
	@if [ -f $(UI_DIR)/.api.pid ] && kill -0 $$(cat $(UI_DIR)/.api.pid) 2>/dev/null; then \
	  echo "✅ API already running (PID: $$(cat $(UI_DIR)/.api.pid))"; \
	else \
	  cd $(UI_DIR) && node server/index.mjs >> $(UI_DIR)/.api.log 2>&1 & echo $$! > $(UI_DIR)/.api.pid; \
	  sleep 0.3; \
	  echo "✅ API started (PID: $$(cat $(UI_DIR)/.api.pid)) → http://localhost:8091"; \
	fi

## Stop the Express API
api-stop:
	@if [ -f $(UI_DIR)/.api.pid ]; then \
	  kill $$(cat $(UI_DIR)/.api.pid) 2>/dev/null && rm -f $(UI_DIR)/.api.pid && echo "✅ API stopped" || echo "⚠️ API was not running"; \
	else \
	  echo "⚠️ API pid file not found"; \
	fi

## Tail the Express API log
api-log:
	@tail -f $(UI_DIR)/.api.log

## Start the Vite UI
ui-start:
	@if [ -f $(UI_DIR)/.ui.pid ] && kill -0 $$(cat $(UI_DIR)/.ui.pid) 2>/dev/null; then \
	  echo "✅ UI already running (PID: $$(cat $(UI_DIR)/.ui.pid))"; \
	else \
	  cd $(UI_DIR) && npx vite >> $(UI_DIR)/.ui.log 2>&1 & echo $$! > $(UI_DIR)/.ui.pid; \
	  sleep 0.3; \
	  echo "✅ UI started (PID: $$(cat $(UI_DIR)/.ui.pid)) → http://localhost:8090"; \
	fi

## Stop the Vite UI
ui-stop:
	@if [ -f $(UI_DIR)/.ui.pid ]; then \
	  kill $$(cat $(UI_DIR)/.ui.pid) 2>/dev/null && rm -f $(UI_DIR)/.ui.pid && echo "✅ UI stopped" || echo "⚠️ UI was not running"; \
	else \
	  pkill -f "vite" 2>/dev/null && echo "✅ UI stopped" || echo "⚠️ UI pid file not found"; \
	fi

## Tail the Vite UI log
ui-log:
	@tail -f $(UI_DIR)/.ui.log

## Restart the Vite UI
ui-restart: ui-stop ui-start

## Start API + UI
start-all: api-start ui-start
	@echo ""
	@echo "🚀 Dashboard ready"
	@echo "   API: http://localhost:8091  (make api-log)"
	@echo "   UI:  http://localhost:8090  (make ui-log)"
	@echo ""
	@echo "Stop with: make stop-all"

## Stop API + UI
stop-all: ui-stop api-stop
	@echo "✅ Dashboard stopped"

## Remove install marker
uninstall:
	@rm -f $(RC_FILE)
	@echo "✅ Uninstalled (per-project symlinks in .claude/skills/laneconductor remain)"

# ─────────────────────────────────────────────────────────────────────────────
# LaneConductor — per-project targets (appended to project Makefiles)
# These are thin aliases kept for discoverability via `make help`.
# All functionality is available directly via: lc <command>
# ─────────────────────────────────────────────────────────────────────────────
.PHONY: lc-install lc-start lc-stop lc-restart lc-log lc-status \
        lc-api-start lc-api-stop lc-ui-start lc-ui-stop lc-start-all lc-stop-all

lc-install:
	@lc install

lc-start:
	@lc start

lc-stop:
	@lc stop

lc-restart:
	@lc restart

lc-log:
	@lc logs worker

lc-status:
	@lc status

lc-api-start:
	@lc api start

lc-api-stop:
	@lc api stop

lc-ui-start:
	@lc ui start

lc-ui-stop:
	@lc ui stop

lc-start-all:
	@lc api start && lc ui start && lc start

lc-stop-all:
	@lc stop && lc ui stop && lc api stop
