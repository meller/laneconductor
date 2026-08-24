SKILL_DIR  := $(shell pwd)/.claude/skills/laneconductor
RC_FILE    := $(HOME)/.laneconductorrc
UI_DIR     := $(shell pwd)/ui

.DEFAULT_GOAL := help

.PHONY: help install uninstall install-node install-atlas install-db install-migrate ui-install install-cli api-start api-stop api-log ui-start ui-stop ui-log ui-restart start-all stop-all

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

## Ensure Node.js is installed (native Linux binary, not Windows interop)
install-node:
	@NODE_PATH=$$(command -v node 2>/dev/null); \
	if [ -n "$$NODE_PATH" ] && echo "$$NODE_PATH" | grep -qv '^/mnt/'; then \
	  echo "✅ Node.js $$(node --version) already installed ($$NODE_PATH)"; \
	else \
	  if [ -n "$$NODE_PATH" ]; then \
	    echo "⚠️  Found Windows node at $$NODE_PATH — installing native Linux node"; \
	  else \
	    echo "📦 Node.js not found — installing via nvm..."; \
	  fi; \
	  curl -fsSL https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.3/install.sh | bash; \
	  export NVM_DIR="$$HOME/.nvm"; \
	  [ -s "$$NVM_DIR/nvm.sh" ] && . "$$NVM_DIR/nvm.sh"; \
	  nvm install --lts; \
	  echo "✅ Node.js $$(node --version) installed"; \
	  echo ""; \
	  echo "⚠️  Restart your shell (or run: source ~/.bashrc) to activate node in this session"; \
	fi

## Install LaneConductor (run once after cloning)
install: install-node install-atlas ui-install install-cli install-db install-migrate
	@echo "$(SKILL_DIR)" > $(RC_FILE)
	@echo ""
	@echo "✅ LaneConductor installed!"
	@echo "   Dashboard: http://localhost:8090"
	@echo ""
	@echo "Next: for each project you want to track:"
	@echo "  cd your-project"
	@echo "  lc setup"
	@echo ""

## Install Atlas CLI (database migration tool)
install-atlas:
	@if command -v atlas >/dev/null 2>&1; then \
	  echo "✅ Atlas already installed: $$(atlas version 2>&1 | head -1)"; \
	else \
	  echo "📦 Installing Atlas CLI..."; \
	  curl -sSf https://atlasgo.sh | sh; \
	  echo "✅ Atlas installed: $$(atlas version 2>&1 | head -1)"; \
	fi

## Start a local Postgres via Docker (or detect native)
install-db:
	@if command -v docker >/dev/null 2>&1 && docker info >/dev/null 2>&1; then \
	  if docker ps --filter name=laneconductor-pg --filter status=running --format '{{.Names}}' | grep -q laneconductor-pg; then \
	    echo "✅ Postgres already running (Docker: laneconductor-pg)"; \
	  elif docker ps -a --filter name=laneconductor-pg --format '{{.Names}}' | grep -q laneconductor-pg; then \
	    echo "▶️  Starting existing laneconductor-pg container..."; \
	    docker start laneconductor-pg; \
	    echo "⏳ Waiting for Postgres to be ready..."; \
	    for i in $$(seq 1 30); do \
	      docker exec laneconductor-pg pg_isready -U postgres >/dev/null 2>&1 && break; \
	      sleep 1; \
	    done; \
	    echo "✅ Postgres ready"; \
	  else \
	    echo "📦 Starting Postgres via Docker..."; \
	    docker run -d --name laneconductor-pg \
	      -e POSTGRES_USER=postgres \
	      -e POSTGRES_PASSWORD=postgres \
	      -e POSTGRES_DB=laneconductor \
	      -p 5432:5432 \
	      --restart unless-stopped \
	      postgres:16; \
	    echo "⏳ Waiting for Postgres to be ready..."; \
	    for i in $$(seq 1 30); do \
	      docker exec laneconductor-pg pg_isready -U postgres >/dev/null 2>&1 && break; \
	      sleep 1; \
	    done; \
	    echo "✅ Postgres ready (Docker: laneconductor-pg)"; \
	  fi; \
	elif pg_isready >/dev/null 2>&1; then \
	  echo "✅ Native Postgres already running"; \
	else \
	  echo ""; \
	  echo "⚠️  No Postgres found. Options:"; \
	  echo "   • Install Docker and re-run make install"; \
	  echo "   • Install Postgres: sudo apt install postgresql"; \
	  echo ""; \
	  exit 1; \
	fi

## Run database migrations via Atlas
install-migrate:
	@echo "🗄️  Running migrations..."
	@atlas migrate apply --env local 2>&1 && echo "✅ Migrations applied" || \
	  (echo "⚠️  Migration failed — is Postgres running? (make install-db)" && exit 1)

## Install global 'lc' command
install-cli:
	@echo "📦 Installing global 'lc' command to /usr/local/bin/lc..."
	@sudo ln -sf $(PWD)/bin/lc.mjs /usr/local/bin/lc
	@sudo chmod +x /usr/local/bin/lc
	@echo "✅ 'lc' command ready"

## Install UI dependencies
ui-install:
	@echo "📦 Installing UI dependencies..."
	@export NVM_DIR="$$HOME/.nvm"; [ -s "$$NVM_DIR/nvm.sh" ] && . "$$NVM_DIR/nvm.sh"; \
	if [ -d ui/node_modules/@rollup/rollup-win32-x64-msvc ] && ! [ -d ui/node_modules/@rollup/rollup-linux-x64-gnu ]; then \
	  echo "⚠️  Windows node_modules detected on Linux — cleaning and reinstalling..."; \
	  rm -rf ui/node_modules; \
	fi; \
	cd ui && npm install
	@echo "✅ UI ready"

## Start the Express API
api-start:
	@if [ -f $(UI_DIR)/.api.pid ] && kill -0 $$(cat $(UI_DIR)/.api.pid) 2>/dev/null; then \
	  echo "✅ API already running (PID: $$(cat $(UI_DIR)/.api.pid))"; \
	else \
	  cd $(UI_DIR) && nohup node server/index.mjs >> $(UI_DIR)/.api.log 2>&1 & echo $$! > $(UI_DIR)/.api.pid; \
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
	  cd $(UI_DIR) && nohup npx vite >> $(UI_DIR)/.ui.log 2>&1 & echo $$! > $(UI_DIR)/.ui.pid; \
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
