# CircleCred

CircleCred is a React dashboard and Express API for community savings circles. Members keep their personal savings dashboard; circle heads sign in to a separate management dashboard limited to circles assigned to them. Payments are simulated. No real payment provider is connected and no money moves.

## Requirements

- Node.js 24 or newer (the backend uses Node's built-in `node:sqlite` module)
- npm

## Start the backend

```powershell
cd backend
npm install
if (!(Test-Path .env)) { Copy-Item .env.example .env }
```

The API runs at `http://localhost:5000`; health check: `http://localhost:5000/api/health`. On first start it creates `backend/data/circlecred-empty-v1.sqlite` (the default `DATABASE_PATH` relative to the backend process directory), initializes the schema, indexes, constraints, and schema version, and inserts no application records. Normal startup never seeds members, circles, payments, payouts, or scores.

Start the API from this same `backend` directory:

```powershell
npm run dev
```

Public registration is the normal onboarding path. The operator-only `POST /api/auth/bootstrap` endpoint remains available for a separately managed initial administrator account if the deployment needs it; it requires a private `BOOTSTRAP_TOKEN` configured on the backend. The frontend does not request or receive that secret.

## Start the frontend

In another terminal:

```powershell
cd frontend
npm install
Copy-Item .env.example .env
npm run dev
```

Open `http://localhost:5173` and choose **Create a free account**. Register with your name, email, and a private password of at least 12 characters. Registration creates a signed-in member account. Choose **Create a Circle** to become its Circle Head, or choose **Join a Circle** and enter the one-time activation key issued by a Circle Head to your registered email address.

New circles are Open for Members. Add members using single-use activation keys; the prototype displays each key once and does not send email. Members register or sign in with the invited email, enter the key, and submit a request. Review applicants and approve/reject them before freezing the circle. The freeze confirmation lists the approved roster and pending applications; pending requests must be resolved first. Freezing fixes the roster and creates the initial round snapshot. Invitations expire after seven days and can be revoked. The frontend reads `VITE_API_URL` (default in `.env.example`: `http://localhost:5000/api`). Backend CORS allows `CLIENT_URL`, which defaults to `http://localhost:5173`.

To demo member management, create a circle, add the member's name and email, and generate an activation key. Copy the key immediately; the app stores only its hash and does not send email. The invited user registers or signs in with that email, enters the key, and submits a membership request. Approve or reject the request in the Circle Head dashboard. Resolve all pending applications before freezing the circle; freezing fixes the roster and creates its initial round.

## Environment variables

Backend settings live in `backend/.env`:

| Variable | Default | Purpose |
| --- | --- | --- |
| `PORT` | `5000` | API port |
| `NODE_ENV` | `development` | Runtime mode |
| `CLIENT_URL` | `http://localhost:5173` | Allowed browser origin |
| `DATABASE_PATH` | `./data/circlecred-empty-v1.sqlite` | SQLite database file path, relative to the backend process directory |
| `BOOTSTRAP_TOKEN` | unset | Optional operator-only secret for the separate backend bootstrap endpoint; never used by the public registration page |
| `SIMULATED_PAYMENT_OUTCOME` | `successful` | Set to `failed` to demonstrate a failed attempt and retry |

Frontend setting lives in `frontend/.env`:

| Variable | Default | Purpose |
| --- | --- | --- |
| `VITE_API_URL` | `http://localhost:5000/api` | Backend API base URL |

The `.env.example` files contain no secrets. Do not put payment credentials in the frontend. The current simulated provider does not request or store card, UPI, or bank credentials.

### Empty development database and existing data

The default path is intentionally separate from existing `backend/data/circlecred.sqlite` and `backend/data/circlecred-clean.sqlite` files. Those existing files are preserved and are never deleted or reset by this setup. To choose another empty file, set `DATABASE_PATH=./data/my-empty-circlecred.sqlite` in `backend/.env` before starting the API. SQLite creates the file and schema on startup; it contains zero business records until users create them. Existing database files keep their records and receive additive schema migrations only. Back up any database before manually changing paths or running migration work.

To make an explicit copy before inspecting or migrating an existing database, stop the API and use PowerShell:

```powershell
Copy-Item .\data\circlecred.sqlite .\data\circlecred-backup-$(Get-Date -Format yyyyMMdd-HHmmss).sqlite
```

Normal startup never resets an existing database. For an explicitly requested local development reset, first stop the API, then run the command below from `backend`. It displays the resolved path, refuses production, requires that same full path as confirmation, takes a consistent timestamped SQLite backup beside the database, and clears application rows in a transaction while preserving schema/migration metadata and indexes:

```powershell
cd backend
$dbPath = (Resolve-Path .\data\circlecred-empty-v1.sqlite).Path
npm run db:reset -- "--confirm-path=$dbPath"
```

Use the exact path printed by the command for your own `DATABASE_PATH`; do not change `.env` just to reset. The backup is retained in the same directory as `*.backup-<timestamp>.sqlite`. The command never runs on startup and refuses if `NODE_ENV=production`. Review and preserve that backup before any later manual cleanup. A fresh schema-only database can instead be created at a new path by setting `DATABASE_PATH` to that path and starting the API; no existing file is deleted or replaced.

Optional development fixtures are separate from normal startup. They require development mode, an explicit confirmation flag, and an empty database with no users:

```powershell
cd backend
$env:NODE_ENV = 'development'
$env:DATABASE_PATH = './data/circlecred-fixtures.sqlite'
npm run seed:demo
```

Those fixtures contain the previous public demo credentials (`ananya@example.test` / `member-demo` and `head@circlecred.demo` / `circlehead-demo`) and must only be used in a disposable local database. The seed command refuses to add fixtures when users already exist. Normal login never displays or pre-fills fixture credentials.

## Data, roles, and APIs

The backend initializes tables for users, circles, memberships, circle-head assignments, monthly rounds and frozen round-member snapshots, invitations, contributions, payments, payouts, payment audit history, reliability score snapshots, and expiring sessions. Foreign keys, unique email/membership/round constraints, positive amount checks, allowed status checks, and payment idempotency keys protect records. Additive startup migrations preserve existing local SQLite files.

Useful routes include:

- `POST /api/auth/register`, `POST /api/auth/login`, `GET /api/auth/me`, `POST /api/auth/logout`
- `POST /api/auth/invitations/redeem` submits a signed-in user's one-time activation key as a pending membership request; the registered email must match, and Circle Head approval is required before any circle access
- Member session: `GET /api/dashboard`, own profile/membership/circle/contribution/payment/history data, and own savings scores
- Circle head session: `GET /api/head/circles`, scoped dashboard and member routes under `/api/head/circles/:circleId`, and scoped payout history/requests
- Circle Head member management: `POST /api/head/circles/:circleId/invitations` creates a seven-day, one-use activation key. The raw key is returned once to the Circle Head (stored as a SHA-256 hash) for copying and sharing; no activation link is generated. Members register or sign in, enter the key, and request membership. The Head reviews applications at `GET /api/head/circles/:circleId/members`, decides them at `POST /api/head/circles/:circleId/applications/:requestId/decision`, and can revoke unused keys with `PATCH /api/head/circles/:circleId/invitations/:invitationId`. Circle Heads never set passwords. `PATCH /api/head/circles/:circleId/members/:membershipId` can change membership only while the circle is open.
- Monthly targets: `POST /api/head/circles/:circleId/rounds` starts a round with a positive fixed target, an in-month deadline, and a snapshot of eligible members. `PATCH /api/head/circles/:circleId/schedule` changes defaults for later rounds. An explicit `/rounds/:roundId/adjust` action requires a reason and adds an audit event.

New circles start Open for Members and never freeze automatically. The Circle Head reviews the approved roster and pending applications in the Freeze Circle confirmation. Pending applications must be explicitly approved or rejected first; freezing is rejected while any remain. The explicit freeze transaction records the timestamp and audit event, then creates the current month's initial round snapshot from approved members. Frozen circles reject new applications and roster changes. Later rounds snapshot the same approved roster. Legacy circles that already had approved memberships or round history are marked frozen by migration 2 so existing rosters and records remain protected. The current round freezes its eligible membership, target amount, and deadline. Later member or default-schedule changes take effect in future rounds. Expected pool is the frozen eligible member count multiplied by the round target. Round dashboards derive confirmed collections from successful installment payment records, then calculate each member's remaining balance and paid/pending/failed/overdue state. Circle heads can view contact details for members in circles assigned to them. Backend routes scope every management operation to the head's circle assignment. Requests and voting are not implemented in this prototype, and the dashboard labels that section as unavailable. Payout requests are saved as pending and capped by collected funds not already allocated. There is no head API to mark a payout or contribution successful.

Payment creation returns `pending`. Members can submit multiple positive installment amounts against their own open round-member obligation, up to the remaining fixed target. Successful installments alone contribute to collection totals. Reliability scoring rolls all installments into one round obligation and counts that obligation as successful only after the full target is confirmed, so installments do not multiply score successes. The member payment route calls the simulated provider abstraction to settle a payment and records the outcome and audit history. Repeated idempotency keys return the original payment only for the same member and amount. No real payment provider or money transfer is connected.

## Authentication and access

The app uses scrypt password hashes, random expiring server-side sessions, hashed session tokens, and an HttpOnly, SameSite cookie. Public registration creates a member account and signs it in. A member with no existing circle membership can create a circle; the backend transaction promotes that account to Circle Head and assigns the new circle. Joining requires a valid activation key matching the registered email. Redemption creates a pending request and consumes the key; it never grants circle access until the Circle Head approves. Failed key attempts are limited to ten per account per 15-minute window. Keys expire after seven days and can be revoked by the managing Circle Head. The API checks roles and circle assignments on protected routes. The operator bootstrap endpoint remains optional and backend-only. This remains a prototype authentication setup: login throttling and account recovery are not implemented, and deployment requires HTTPS and operational security review.

## Savings Reliability Score

The internal indicator ranges from 0 to 850 and combines on-time contributions (35%), contribution consistency (25%), completed cycle participation (15%), delayed payment history (15%), and participation history (10%). Responses include factor values, points, weights, and descriptions. This indicator is not an official credit score and does not guarantee loan approval.

## Build and tests

```powershell
cd backend
npm test
npm run build
```

```powershell
cd frontend
npm test
npm run build
npm run lint
```

Backend tests cover empty schema-only initialization, public registration and password hashing, member-to-head promotion, invitation-code join/expiry/single use, one-time optional operator bootstrap, legacy schema upgrades, sign-in/session logout, role and circle permissions, target validation and locking, frozen membership snapshots, explicit adjustments with audit reasons, expected-pool calculations, partial installments, one-obligation scoring, collection statuses, and payout safeguards. Frontend tests cover dashboard loading/errors, member onboarding validation, installment amount normalization/validation, and round target/deadline validation and pool calculations.
