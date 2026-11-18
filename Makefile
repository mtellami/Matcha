.DEFAULT_GOAL := help
DEV = docker compose --project-name matcha-dev -f compose.yaml -f compose.dev.yaml
PROD = ENV_FILE=.env.production docker compose --project-name matcha-prod --env-file .env.production -f compose.yaml

.PHONY: help dev dev-down dev-clean dev-logs dev-seed backend-dev frontend-dev prod prod-down prod-logs
help: ## Show available commands
	@awk 'BEGIN {FS = ":.*## "} /^[a-z-]+:.*## / {printf "  %-16s %s\n", $$1, $$2}' $(MAKEFILE_LIST)

dev: ## Start database, RustFS, and Mailpit for local app development
	$(DEV) up -d --wait db rustfs mailpit

backend-dev: dev ## Start local infrastructure and run the backend
	cd backend && set -a && . ../.env && set +a && export DATABASE_URL="$${DATABASE_URL/@db:/@localhost:}" S3_ENDPOINT_URL="$${S3_ENDPOINT_URL/rustfs:/localhost:}" SMTP_HOST=127.0.0.1 APP_ORIGIN=http://localhost:5173 && uv pip install --python .venv/bin/python -r requirements.lock && . .venv/bin/activate && python manage.py migrate && python manage.py storage-init && gunicorn --bind 0.0.0.0:5000 --workers 1 --threads 50 app:app

frontend-dev: ## Run the frontend locally
	cd frontend && pnpm install --frozen-lockfile && pnpm run dev

dev-down: ## Stop development (preserve data)
	$(DEV) down

dev-clean: ## Remove development containers, network, and volumes (delete local data)
	$(DEV) down --volumes --remove-orphans

dev-logs: ## Follow development logs
	$(DEV) logs -f

dev-seed: ## Seed 500 demo profiles in development only
	cd backend && set -a && . ../.env && set +a && export DATABASE_URL="$${DATABASE_URL/@db:/@localhost:}" && . .venv/bin/activate && python manage.py seed

prod: ## Build and start production apps behind Nginx (hosted S3/SMTP)
	$(PROD) up --build -d --remove-orphans

prod-down: ## Stop production (preserve data)
	$(PROD) down

prod-logs: ## Follow production logs
	$(PROD) logs -f
