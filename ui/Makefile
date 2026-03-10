.PHONY: help install dev stop lc-verify

help:
	@echo "Available commands:"
	@echo "  make install    Install dependencies"
	@echo "  make dev        Start the dev server (API + Vite)"
	@echo "  make stop       Stop the dev server"
	@echo "  make lc-verify  Verify the heartbeat pipeline"

install:
	npm install

dev:
	npm run dev

stop:
	@pkill -f "node server/index.mjs" 2>/dev/null || true
	@pkill -f "vite" 2>/dev/null || true
	@echo "✅ UI stopped"

lc-verify:
	@cd .. && ./conductor/lc-verify.sh
