# Matcha

React, Flask, PostgreSQL, and Nginx. Requirements: `requirments.pdf`. Remaining application work: [IMPLEMENTATION.md](IMPLEMENTATION.md).

## Development

1. Copy `.env.example` to `.env` if needed. Replace the database and S3 credential placeholders. Use the same database password in `DB_PASSWORD` and `DATABASE_URL`.
2. Run `make dev`.
3. Run `make dev-seed` to create 500 demo profiles.

App: http://localhost:8080. Mailpit inbox: http://localhost:8025. RustFS console: http://localhost:9001, using the S3 credentials from `.env`.

Demo login: `demo1` through `demo500`, password `Demo!River8Cloud&2026`.

## Production

Create `.env.production` with your database credentials, public `APP_ORIGIN`, hosted S3 settings, and real SMTP settings. Set `S3_CREATE_BUCKET=false` and provision the private bucket first. Run `make prod`.

Nginx serves React and proxies the API and WebSockets to Flask. Both environments use the same application containers; `compose.dev.yaml` only adds RustFS and Mailpit. Rebuild with `make dev` or `make prod` after code changes.

Nginx defaults to `127.0.0.1:8080`; configure `HTTP_BIND` and `HTTP_PORT` if needed. For public HTTPS, point your hosting TLS ingress at Nginx, set `APP_ORIGIN` to the public HTTPS URL, and set `COOKIE_SECURE=true`. Certificates are managed by the hosting ingress.

## Commands

```sh
make dev          # Start app + RustFS + Mailpit; initialize photo bucket
make dev-seed     # Seed demo profiles
make dev-logs     # Follow logs
make dev-down     # Stop, keeping data

make prod         # Start app with hosted S3 and SMTP
make prod-logs
make prod-down
```

Dev uses `.env`; prod uses `.env.production`. These files are ignored by Git. Dev/prod have separate Compose project names to keep their databases separate.

Only PostgreSQL data and uploaded photos have persistent volumes. RustFS logs go to container output, following the [RustFS logging defaults](https://docs.rustfs.com/en/operations/observability).

## Storage and mail

- S3: set `S3_ENDPOINT_URL`, `S3_REGION`, `S3_BUCKET`, `S3_ACCESS_KEY_ID`, and `S3_SECRET_ACCESS_KEY`. Leave the endpoint empty for AWS S3. `S3_ADDRESSING_STYLE=path` works with RustFS; use your provider's required style for hosted storage. AWS roles work when explicit credentials are empty.
- SMTP: set `SMTP_HOST`, `SMTP_PORT`, `SMTP_USERNAME`, `SMTP_PASSWORD`, and `MAIL_FROM`. Use `SMTP_SECURITY=starttls` on port 587 or `ssl` on port 465. Mailpit uses `none`, port 1025, and no authentication.

Photos remain private and are served through authenticated backend requests. Database migrations run at startup. Existing files from a former filesystem photo volume must be copied to S3 under their original filenames before retiring that volume.

## Checks

```sh
npm --prefix frontend install
npm --prefix frontend run build
npm --prefix frontend test

cd backend
uv venv
uv pip install -r requirements.txt
uv run python -m pytest tests -q
```

Frontend API tests need Node 22.6+. Database tests require `TEST_DATABASE_URL` pointing to a migrated disposable PostgreSQL database; set `DATABASE_URL` to the same URL when applying migrations. Without it, database tests are skipped.

To review fake-account reports:

```sh
docker compose --project-name matcha-dev -f compose.yaml -f compose.dev.yaml exec backend python manage.py reports
```

## Validation and browser checks

Passwords are checked against zxcvbn and a bundled common-word supplement in twelve languages. Unicode, accents, simple substitutions, and repeated words are normalized for this check. This is a curated dictionary, not a complete dictionary of every language. Strength estimation examines at most 72 characters to bound its cost; Argon2 hashes and verifies the complete password. See the [estimator's documented length limit](https://pypi.org/project/zxcvbn/).

Location suggestions come from a local catalogue of 32 approximate city centers. Manual selection fills the location automatically; GPS is optional and only requested after a click. Form responses include field-specific errors, shown in an accessible summary with invalid inputs marked.

To run browser acceptance checks against the seeded development app:

```sh
make dev
make dev-seed
cd frontend
npm install
npx playwright install chromium firefox
npm run test:e2e
```

The scenarios run on Chromium, Firefox, and a mobile viewport. They use the synthetic `demo1`/`demo2` accounts, exercise real chat, and leave test messages in the development database. They restore likes they added. Do not run them against production. Set `PLAYWRIGHT_BASE_URL` if the development app uses a different URL.

## Live updates and recovery

The browser uses the existing Socket.IO endpoint for update hints and refreshes authenticated data on connection/reconnection. Five-second HTTP polling continues if sockets are unavailable. Session heartbeats close expired sockets; logout disconnects the local client.

Chat catches up with `GET /api/v1/conversations/{id}/messages?after={last_id}` in ascending pages. The existing `before` cursor still loads older history. This prevents a burst of more than 50 messages from being skipped after a disconnection. Sending retries reuse the message key and overlapping responses are deduplicated by message ID.

Browser acceptance tests also cover a 120-message offline burst and socket-blocked polling fallback. The standalone SQL smoke file can be run against a migrated disposable database with `psql "$TEST_DATABASE_URL" -v ON_ERROR_STOP=1 -f backend/tests/sql_smoke.sql`. It inserts 500 synthetic profiles and rolls them back after assertions and an EXPLAIN check.

Registration is committed before contacting SMTP, so a mail outage does not lose the account. Use **Resend verification email** on the sign-in screen if a link is missing or expired. Reset and resend requests use generic responses for unknown accounts. An email-change delivery failure keeps the current email active and can be retried.
