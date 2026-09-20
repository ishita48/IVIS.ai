# The demo runs out of apps/lens. Every target below that points at services/*
# or apps/web is the earlier architecture the build overtook — apps/lens never
# calls it and apps/web has never been installed. See docs/agent-coordination.md.

.PHONY: up down web proof brain gateway sources contracts types bench reset test dev-deps

up: ## everything, in the order the demo needs it
	docker compose -f infra/elastic/docker-compose.yml up -d
	@echo "elastic up. now run: make proof / brain / gateway / sources / web in separate panes"

down:
	docker compose -f infra/elastic/docker-compose.yml down

proof:
	cd services/proof-engine && uvicorn app.main:app --port 8001 --reload

brain:
	cd services/brain && uvicorn app.main:app --port 8002 --reload

gateway:
	cd services/gateway && uvicorn app.main:app --port 8000 --reload

sources:
	cd services/sources && uvicorn main:app --port 8003 --reload

web:
	cd apps/web && npm run dev

mock: ## frontend alone, no backend required
	cd apps/web && npm run mock

contracts: ## every fixture must validate against its schema
	@python3 contracts/validate.py

dev-deps: ## install contract validation and test dependencies
	python3 -m pip install -r requirements-dev.txt

types: ## regenerate TS types from the schemas
	npx json-schema-to-typescript contracts/hint_response.schema.json > packages/contracts-ts/src/hint.ts
	npx json-schema-to-typescript contracts/run_result.schema.json > packages/contracts-ts/src/run.ts

bench: ## 20-bug CodeNet benchmark (needs OPENAI_API_KEY in apps/lens/.env.local)
	cd apps/lens && npx tsx scripts/bench.ts

test:
	cd services/proof-engine && python3 -m pytest -q
	cd services/brain && python3 -m pytest -q

reset: ## clear indices between demo runs
	curl -XDELETE localhost:9200/lens-mistakes || true
	curl -XDELETE localhost:9200/lens-notes || true
