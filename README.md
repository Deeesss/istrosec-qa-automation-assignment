# IstroSec QA Automation Assignment

Playwright and TypeScript solution for the four tasks in the QA Automation Engineer technical assignment.

The repository contains browser tests, API tests, and a small local Express mock used to validate the agent healthcheck contract.

## Prerequisites

- Node.js 20 or newer
- npm
- Git
- Internet access for installing Chromium and reaching the external demo systems

## Clean-machine setup

```bash
git clone https://github.com/Deeesss/istrosec-qa-automation-assignment.git
cd istrosec-qa-automation-assignment
npm ci
npx playwright install chromium
```

On a fresh Debian or Ubuntu machine, Playwright can install Chromium and its operating-system dependencies together:

```bash
npx playwright install --with-deps chromium
```

No environment file, credentials file, database, or external service account is required. The credentials used by the tests are public demo credentials.

## Run the tests

Run the complete suite with the command required by the assignment:

```bash
npx playwright test
```

The equivalent npm command is:

```bash
npm test
```

Run the TypeScript check separately:

```bash
npm run typecheck
```

## Run one task

```bash
npx playwright test tests/task1-react-admin
npx playwright test tests/task2-jsonplaceholder
npx playwright test tests/task3-healthcheck
npx playwright test tests/task4-auth
```

Task 4 can also be split into its UI and API parts:

```bash
npx playwright test tests/task4-auth/saucedemo-auth.spec.ts
npx playwright test tests/task4-auth/dummyjson-auth.spec.ts
```

## Headed and debug modes

```bash
npm run test:headed
npm run test:debug
```

Screenshots are captured only on failure, and traces are retained on failure in `test-results/`.

Open a trace with:

```bash
npx playwright show-trace path/to/trace.zip
```

## Run the healthcheck mock

Start the Task 3 mock in a separate terminal:

```bash
npm run mock
```

The server listens on `http://127.0.0.1:3001` and exposes:

```text
POST /api/v1/healthcheck
```

Stop it with `Ctrl+C`.

The Task 3 automated tests do not require a separately running mock. They start an isolated server on an available port before the tests and close it afterward, avoiding port conflicts and leftover processes.

## Coverage

| Task | System under test | Coverage | Tests |
| --- | --- | --- | ---: |
| 1 | React Admin demo | Customer list filtering, sorting, and pagination; form validation, customer creation, discarding unsaved edits, and deletion | 7 |
| 2 | JSONPlaceholder | Positive and negative GET, POST, PUT, PATCH, and DELETE behavior, including status, body, and Content-Type | 12 |
| 3 | Local healthcheck mock | Valid payloads, required fields, types, UUIDs, UTC timestamps, adapters, IP addresses, sessions, roles, unknown root-level fields, and JSON parser errors | 23 |
| 4 | SauceDemo and DummyJSON | UI login and session protection, plus API login and bearer-token authorization | 11 |
| **Total** |  |  | **53** |

## Repository structure

```text
.
|-- .github/
|   `-- workflows/
|       `-- playwright.yml
|-- src/
|   `-- mock/
|       |-- healthcheck-schema.ts
|       `-- server.ts
|-- test-data/
|   `-- healthcheck-payload.ts
|-- tests/
|   |-- task1-react-admin/
|   |-- task2-jsonplaceholder/
|   |-- task3-healthcheck/
|   `-- task4-auth/
|-- package.json
|-- package-lock.json
|-- playwright.config.ts
|-- tsconfig.json
`-- README.md
```

## Technical decisions

- The solution stays inside Playwright and TypeScript. Express and AJV are used only for the local validation mock required by Task 3.
- Tests run with one Chromium worker and no retries. Several public demo systems expose shared or mutable data, so serial execution is easier to reason about than parallel mutation.
- UI tests use roles, labels, placeholders, visible names, and stable `data-test` attributes. They do not use fixed sleeps.
- API tests verify response status, Content-Type, and relevant response data. A successful status alone is not treated as proof of correct behavior.
- The healthcheck tests start the mock on an available port and always close it. Manual operation remains available through `npm run mock`.
- DummyJSON bearer authorization is verified in a fresh request context so a login cookie cannot accidentally make `/auth/me` pass.
- GitHub Actions installs dependencies and Chromium, runs the TypeScript check, and executes the complete test suite for pull requests and pushes to `main`.

## Known limitations of the demo systems

- The current React Admin demo has no explicit Cancel button on the customer form. The test changes a field, leaves without saving, reopens the record, and verifies that the stored value did not change.
- The current React Admin demo does not show a confirmation dialog before customer deletion. It deletes the record immediately and provides an Undo action in the notification. The test waits for the notification to close and verifies that the exact disposable record is no longer present.
- JSONPlaceholder is a fake API. POST, PUT, PATCH, and DELETE responses simulate writes but do not prove database persistence. The tests verify its observed public behavior, including responses for unknown identifiers.
- Since [saucelabs/sample-app-web#175](https://github.com/saucelabs/sample-app-web/pull/175) (2026-09-10), SauceDemo exposes the sidebar Logout control as a button instead of a link. The logout test selects it through the `data-test="logout-sidebar-link"` attribute, so it does not depend on the control's accessible role. The failure analysis is in [#7](https://github.com/Deeesss/istrosec-qa-automation-assignment/pull/7).
- React Admin, JSONPlaceholder, SauceDemo, and DummyJSON are external demo systems. Their availability, datasets, messages, and undocumented behavior can change independently of this repository.
- Chromium is the only configured browser project.

## Improvements with more time

- Isolate mutable UI data behind dedicated test accounts or controlled local fixtures instead of shared public demos.
- Add Firefox and WebKit after verifying that the target applications support those browsers.
- Introduce small page objects only if the UI suite grows enough for them to remove meaningful duplication.
- Add scheduled checks for changes in the external demo systems.