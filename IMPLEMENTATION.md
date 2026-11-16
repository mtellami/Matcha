# Implementation status

## Current status

- The code review maps every mandatory feature in Section IV to an implementation; no remaining mandatory product feature gap is currently identified.
- The app is **implementation-complete but not fully signed off**. Full current browser acceptance and several manual security, location, upload, and configuration checks remain unverified.
- The remaining items below are acceptance checks, not known missing product features.
- Bonus implementation is now underway. The first milestone is an editable, drag-and-drop photo upload flow; the remaining bonus ideas are tracked below.

## Bonus implementation

| Bonus feature                                             | Status                                                |
| --------------------------------------------------------- | ----------------------------------------------------- |
| Photo gallery with drag-and-drop upload and basic editing | Implemented; PR CI passed; browser acceptance pending |
| OmniAuth authentication strategies                        | Not started                                           |
| Interactive user map with precise GPS location            | Not started                                           |
| Audio or video chat for connected users                   | Not started                                           |
| Date and event scheduling for matches                     | Not started                                           |

## Implemented

- Activity milestone: sent/received interest cards with primary photos, reciprocal connection status, direct chat, and interest withdrawal; blocked and unverified users excluded from both lists.
- Individual notification read acknowledgements, unread filtering, sender photos/event icons, keyboard-accessible activity tabs, and five-second fallback refresh that retains loaded notification/visitor history.
- Guided profile completion with progress, links to missing fields, selectable reusable interests, and a public-profile preview without self-relationship controls.
- Exact frontend/backend dependency lockfiles used by Docker builds; database pool cleanup for CLI commands and test shutdown.
- Chat reliability milestone: paginated discovery in the acceptance path, bounded chat request times, visible-message read acknowledgements with retries, multi-tab/reconnect/offline-burst/polling/disconnect/block browser coverage, and reusable demo sessions that respect auth throttling.
- Make targets for dev/prod; production multi-stage React build served by Nginx with API/WebSocket proxy; identical application services in dev/prod.
- Core Compose plus compose.dev.yaml with RustFS and Mailpit; SQL migrations, environment template, deterministic 500-profile seed.
- Private S3-compatible photo storage for uploads, reads, deletion, and seed images. Configurable endpoint/region/addressing and AWS credential-chain support.
- Configurable SMTP with verified STARTTLS or implicit TLS and optional authentication.
- Branded responsive HTML account emails with clear verification/reset/email-change action buttons and equivalent plain-text fallbacks.
- Registration, email verification, username/password login, logout, reset, verified email-change API.
- Session cookies, CSRF checks, origin checks, database-backed auth throttling, safe errors.
- Profile editing, adulthood checks, gender/preferences, reusable normalized tag strings, approximate location.
- Image upload, five-photo limit, primary selection/deletion APIs, authenticated image access.
- Discovery and advanced-filter API, deterministic sorting, distance, shared tags, fame.
- Profile visits, incoming-like/visitor API, likes, mutual connections, blocks, reports.
- Authorized persistent messages, idempotency keys, notification persistence and socket dispatcher.
- React sign-in/registration/reset, discovery, profile editing/upload, activity, profile detail, chat.
- Advanced discovery UI with age/fame/distance/location/shared-tag filters, sort direction, pagination, and URL persistence.
- Suggested-profile ranking always keeps same-city profiles ahead of other areas, including when the user chooses descending recommendation order.
- Activity tabs for visitors, received likes, notifications, and unblock controls; profile photo/gallery and email-change controls.
- Inbox with independent unread-message counts, cursor-based chat/notification/visitor histories, retry-safe sends, and bounded read acknowledgements.
- Per-tab authenticated presence with expiry, public online/last-connected status, and session-scoped socket notifications.
- Report-review CLI and stable HTTP error codes; split typed frontend components and centralized error-aware API helper.
- Matching/search/API-client unit tests and expanded database integration scenarios.
- Curated common-password supplement across 12 languages, normalization of accents/Unicode/simple substitutions/repetition, bounded strength estimation, and account-context checks during registration.
- Shared offline location catalogue with 32 city centers; server-side manual selection and stale GPS/city-label validation. Coordinates are no longer required in the manual-location UI.
- Aggregated profile field errors, field-specific account/upload errors, accessible error summaries, and invalid-field markers.
- Concurrent-request integration scenarios for reciprocal likes, block-versus-message races, and the five-photo cap.
- Playwright acceptance scenarios for Chromium/Firefox/mobile covering weak passwords, discovery, profile validation, logout, two-user chat, a 120-message offline burst, and socket-blocked fallback.
- Frontend Socket.IO update hints with reconnect refresh, coalesced notifications, five-second HTTP fallback, and authenticated socket heartbeats.
- Ascending `after` pagination for complete incremental message recovery, deduplicated history merges, and queued refreshes while requests are in flight.
- Socket lifecycle and recovery unit tests; database scenarios for expiry, failed-delivery retries, and persisted history after reconnect.
- Account creation commits before SMTP delivery, with verification resend and generic reset/resend responses. New links use URL fragments to keep tokens out of page request URLs and HTTP referrers.
- Mailpit-backed browser flows cover signup verification and single-use links, resend, password reset with old-session revocation, and email change with reset delivery to the new address.
- Accessibility and recovery feedback: live search-result and pagination announcements, descriptive profile and photo controls, chat sender announcements, Inbox refresh/retry, notification-read confirmations, retryable city suggestions, and success feedback for reports.
- Bounded image decoding/re-encoding with EXIF orientation and metadata removal. Photo publication/removal uses transactional cleanup reservations and a retrying backend cleanup loop; no additional service or container.
- Seed photos use the same publication path with unique keys, avoiding deletion of a re-seeded photo by stale cleanup work.
- Account locks serialize credential changes with login and presence/logout writes. Reset and email confirmation revoke all sessions and pending account links for that user, with wall-clock expiry rechecks before token consumption.
- Security regression scenarios cover concurrent old-password login/reset, single-use redemption, competing email claims, stale recovery links, presence/logout races, session-bound CSRF, cookie flags, and authentication throttling.

## Acceptance still required before claiming full compliance

- Finish the current full browser acceptance run in Chrome, Firefox, and mobile after updating locators for the new accessible names. A recent run passed 28/32 scenarios; the remaining four chat cases were locator mismatches. The corrected focused flow passed in Chromium and Chrome; Firefox and mobile were not completed.
- Re-run reconnect, offline-burst, and polling-fallback scenarios across the target browsers and record live delivery latency. Earlier chat milestone runs passed, but the latest accessibility changes have not had a complete cross-browser rerun.
- Finish the manual acceptance scenarios below, especially GPS permission allow/deny behavior, upload handling, injection/error handling, and configuration/persistence checks. Existing backend regression coverage includes security, storage, relationships, and notification behavior.
- Accessibility and loading/error feedback have been implemented across the main screens; finish the browser review. The external font dependency has been removed in favor of system fonts.

## Validation performed in authoring environment

- 2026-11-16 bonus milestone: profile photo editor now accepts multi-file drag-and-drop, previews a square crop, supports crop zoom/position, 90-degree rotation, and natural/warm/black-and-white/bright filters, then uploads edited JPEGs through the existing validated photo endpoint. The existing five-photo cap and private storage path remain in use. Browser acceptance for this new flow is pending.
- 2026-11-16: the photo-editor production build and pre-commit hooks passed. PR #1 (`feature/bonus-photo-gallery`) passed all three CI jobs: formatting/lint, frontend build/unit tests, and backend tests. The PR is open and not merged.
- 2026-11-16 browser acceptance attempt: all 12 Chromium flows passed, including account email, activity, discovery/profile, and live chat recovery. The full 48-case cross-project run then hit the development API's shared 30-auth-requests-per-IP/15-minute guard in the Chrome project; Firefox and mobile were not completed. Treat cross-browser acceptance as pending, not as an app feature failure.

- Activity milestone: 141 backend scenarios pass on disposable PostgreSQL 17; 28 frontend unit scenarios (six test files) pass, including history recovery after large bursts and removal of stale filtered rows. Production builds pass.
- All six live activity browser scenarios passed across Chromium, Firefox, and the mobile viewport: sent-interest matching/withdrawal/reciprocation, notification delivery with sockets blocked within ten seconds, individual read state, and opening the message sender’s conversation. Desktop and mobile screenshots were inspected. These checks do not replace the pending full acceptance suite.
- Continuation on 2026-11-15: dependencies installed, exact lockfiles generated, strict React/TypeScript production build passed, and all 24 frontend unit scenarios (five test files) passed. Both Docker images build with the lockfiles.
- All 134 backend scenarios passed against a migrated disposable PostgreSQL 17 database (`matcha_verification_20261115`), with no database skips. The live development seed ran against RustFS and SQL confirmed 500 complete demo profiles with photos.
- Chat reliability milestone: production frontend build and 32 frontend unit tests pass; the complete 32 browser scenarios pass in Chromium, Firefox, configured mobile viewport, and installed Google Chrome (24 scenarios in the first three projects, eight in Chrome). Two-user chat live delivery measured 0.8–1.4 seconds; 120-message offline recovery 0.19–0.91 seconds; socket-blocked HTTP delivery 0.06–0.14 seconds; stalled-request recovery 4.2–4.5 seconds. Retry deduplication, multi-tab reads, and disconnect/block revocation passed in every project.
- Development services now run at http://localhost:8080 using the production React/Nginx image. Browser password-feedback and profile-validation scenarios passed on Chromium and Firefox. The initial full browser run exposed an exact-label locator problem in sorting (corrected) and a chat setup timeout; full acceptance is still pending.
- New profile completion, public preview, reusable-interest selection, and existing profile validation passed all nine focused browser scenarios on Chromium, Firefox, and the mobile viewport. The new-member checklist scenario uses an intercepted incomplete `/me` response with a real authenticated session; it does not claim end-to-end registration coverage.
- Account-email milestone: all four live Mailpit browser scenarios passed on Chromium. This covered signup verification and link reuse rejection, resend delivery, password reset and session revocation, and verified email change with subsequent reset delivery to the new address.
- Accessibility-feedback milestone: the local development image rebuilt successfully, including the frontend TypeScript and Vite production build. In the subsequent broad browser run, 28/32 Activity/profile/chat scenarios passed across Chromium, Chrome, Firefox, and mobile. The four chat cases were traced to selectors that still expected the old accessible labels; selectors were updated. The focused chat flow then passed on Chromium and Chrome with live delivery at 0.39s and 0.91s, offline-burst recovery at 0.21s and 0.24s, polling delivery at 0.10s, and stalled-request recovery at 4.40s. Firefox/mobile focused runs and a full rerun were interrupted and remain unverified.
- Latest UI feedback changes also announce notification-read results, provide Inbox retry and city-suggestion retry controls, expose chat messages as a named live log, and present successful reports as status messages instead of errors. These final changes have not had a new build or browser run.
- Requirements review found and fixed one mandatory discovery behavior gap: descending recommendation order could put profiles outside the user’s city first. The ranking now keeps locality priority fixed while reversing the secondary distance, shared-interest, fame, and id ordering. This source change has not been run or validated.

Earlier sandbox-only validation (superseded where live results are given above):

- Python compilation succeeded.
- 93 Python unit tests and 20 frontend API/location/chat/socket-lifecycle tests passed. 41 database integration scenarios explicitly skip without TEST_DATABASE_URL. Browser scenarios have been authored but have not run.
- Production Compose and the combined development configuration validate. RustFS/real-provider integration has not run.
- Dependency installation failed because package registries were unreachable (DNS/network restriction).
- Docker daemon access was denied; even a local PostgreSQL server cannot bind a Unix socket in this sandbox. Container startup, API database integration, frontend build/full typecheck, and browser verification have not run.
- A disposable PostgreSQL 18 cluster ran successfully in standalone mode: all migrations applied; 94 application SQL statements prepared against the schema; 500-profile SQL smoke assertions also cover account recovery revocation/wall-clock expiry, photo publication/removal rollbacks and protection of live objects, as well as incremental history, idempotent inserts, bounded read tracking, multi-tab/session presence, and mute/block filtering. Fixtures rolled back. A discovery EXPLAIN used the existing relationship/photo indexes. This is not a substitute for the PostgreSQL 17 API integration suite.
- Strict TypeScript checks passed for API/chat/realtime/location/type helpers. Transpilation syntax checks passed for all 15 frontend source/config/browser-test modules. Full React typecheck still requires dependencies.

## Mandatory acceptance checklist

These are verification steps, not a claim that the full stack has passed them.

| PDF area             | Coverage and final acceptance scenario                                                                                                                                                                                           |
| -------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| General instructions | Handwritten SQL and safe-error/CSRF/privacy tests exist. Finish current injection, upload, accessibility, mobile, and Chrome/Firefox acceptance on the running app.                                                              |
| Registration/sign-in | Mailpit browser coverage now passes for registration verification/link reuse, resend, reset/session revocation, and email change. Finish logout-from-every-view acceptance.                                                      |
| Profile              | Validate required fields, preference defaults, reusable interests, name/email changes, primary-photo selection, and the five-photo limit. Concurrent-upload scenario is included.                                                |
| Location             | Unit tests cover city selection, invalid coordinates, and mismatched GPS labels. Browser checks for denied/granted GPS permission and approximate-coordinate storage remain.                                                     |
| Browsing/search      | Unit tests cover combined ranges/tags and invalid filters; browser scenario covers filters and URL persistence. Verify same-city priority, reciprocal preferences, sort directions, and pagination against controlled seed data. |
| Profile activity     | Check visitor history, received interest, fame, gallery, online/offline state, fake-account reports, and unblock controls. Confirm public responses omit credentials/email/birth date/coordinates.                               |
| Relationships        | Integration scenarios cover mutual likes, photo prerequisites, unlikes, blocks, and simultaneous reciprocal likes. Confirm disconnect disables chat immediately and suppresses future notifications as specified.                |
| Chat                 | Integration scenarios cover authorization, retries, unread state, history, and block/send races. Browser scenario checks two-user delivery within ten seconds. Test reconnect and multi-tab use while services are running.      |
| Notifications        | Verify like, visit, message, match, and disconnect events; global unread counts; read acknowledgements; block/mute suppression; and session-revoked delivery. Confirm latency stays within ten seconds under evaluation load.    |
| Evaluation dataset   | Run the idempotent seed against RustFS/PostgreSQL and confirm at least 500 distinct complete profiles with synthetic photos.                                                                                                     |
| Configuration        | Production and development Compose validate; verify clean startup, bucket creation in development, hosted S3/SMTP configuration, and persistence across restarts.                                                                |

The dictionary is a curated supplement, and the location catalogue is intentionally finite. More languages/cities can be added through the existing data files without introducing services.

## Git history in this session

The project repository was initialized with elevated filesystem access on 2026-11-15, and all nine prepared feature commits were imported into its `master` branch. The Git index matches the current files and the working tree is clean. The sandbox still masks `.git`, so Git commands may require elevated access. `/tmp/matcha-feature-commits.bundle` remains a backup of the complete history.

Continuation commits `ac47bbe` (dependency locks and database worker cleanup) and `da30510` (guided profile completion, reusable interests, public preview) are included in the refreshed bundle. The final backend run passed 134 scenarios in 3.14 seconds without shutdown warnings.

Recent commits: `337013f` (branded account email templates), `e6064dc` (preserve same-city priority for descending suggestions), `3e4e61b` (Mailpit account-email flows), `a5dab45` (Discovery accessibility), `96e7de2` (cross-screen accessibility and feedback), and `2aa48ce` (report success feedback and matching browser locators). Activity milestone commits include `7db8aa5` and `82c26d3`. `IMPLEMENTATION.md` is ignored by `.gitignore`, so this progress record is local and is not included in those commits.
