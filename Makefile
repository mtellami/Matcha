.DEFAULT_GOAL := help
DEV = docker compose --project-name matcha-dev -f compose.yaml -f compose.dev.yaml
PROD = ENV_FILE=.env.production docker compose --project-name matcha-prod --env-file .env.production -f compose.yaml

.PHONY: help dev dev-down dev-logs dev-seed prod prod-down prod-logs
help: ## Show available commands
	@awk 'BEGIN {FS = ":.*## "} /^[a-z-]+:.*## / {printf "  %-16s %s\n", $$1, $$2}' $(MAKEFILE_LIST)

dev: ## Start the shared app stack plus RustFS and Mailpit
	$(DEV) up --build -d --wait
	$(DEV) exec -T backend python manage.py storage-init

dev-down: ## Stop development (preserve data)
	$(DEV) down

dev-logs: ## Follow development logs
	$(DEV) logs -f

dev-seed: ## Seed 500 demo profiles in development only
	$(DEV) exec backend python manage.py seed

prod: ## Build and start production apps behind Nginx (hosted S3/SMTP)
	$(PROD) up --build -d --remove-orphans

prod-down: ## Stop production (preserve data)
	$(PROD) down

prod-logs: ## Follow production logs
	$(PROD) logs -f
