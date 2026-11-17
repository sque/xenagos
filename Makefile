# Build and check both packages. The released Python package bundles the built viewer, so users need no Node.

.PHONY: all web build check check-server check-web clean

all: check build

web:
	cd web && npm ci && npm run build

build: web
	cd server && uv build

check: check-server check-web

check-server:
	cd server && uv run ruff check && uv run ruff format --check && uv run mypy && uv run pytest -q

check-web:
	cd web && npm run lint && npm run typecheck && npm test

clean:
	rm -rf server/dist server/src/xenagos/static web/node_modules/.tmp
