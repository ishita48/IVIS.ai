.PHONY: up down web proof brain gateway sources contracts types bench reset test

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
	@python3 -c "import json,sys; \
	from pathlib import Path; \
	ok=all(json.loads(p.read_text()) for p in Path('contracts/fixtures').glob('*.json')); \
	print('fixtures parse: ok')"

types: ## regenerate TS types from the schemas
	npx json-schema-to-typescript contracts/hint_response.schema.json > packages/contracts-ts/src/hint.ts
	npx json-schema-to-typescript contracts/run_result.schema.json > packages/contracts-ts/src/run.ts

bench:
	cd services/brain && python -m bench.run_bench

test:
	cd services/proof-engine && python -m pytest -q
	cd services/brain && python -m pytest -q

reset: ## clear indices between demo runs
	curl -XDELETE localhost:9200/lens-mistakes || true
	curl -XDELETE localhost:9200/lens-notes || true
