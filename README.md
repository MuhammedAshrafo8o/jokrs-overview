# JOKRS — Cancellation, Refunds & Rescheduling (office portal simulation)

Interactive, Arabic-first (RTL) frontend simulation of one configurable module that lets different provider offices define, publish, apply and operate cancellation / refund / rescheduling policies — without custom code per office.

> **Simulation only.** No real payments, refunds, messages, APIs or legal approvals. All offices, people, policies and numbers are fictional. Demo rules are **not** Saudi legal requirements; platform guardrails are editable demo fixtures whose legal status is unverified. Frontend role simulation is **not** production security. The blue palette is provisional, not the official JOKRS brand.

## Three standalone views (tabs at the top)

| Tab | Who | What you can do |
|---|---|---|
| **بوابة المكتب** | Office staff (admin / operations / finance / viewer) | The original portal: policies, builder, assignments, requests, refunds, activity, simulator. |
| **تطبيق العميل** | A fictional customer (pick any of the 24, grouped by office) | Phone app: book a package and accept the policy before paying; view bookings and the accepted policy snapshot; cancel / reschedule / report an issue with the live fee and refund preview; reply to office proposals and info requests; track refunds; wallet and visit credits. A "behind the scenes" panel shows the audit events for that customer. |
| **لوحة منصة JOKRS** | Platform reviewer | Cross-office overview and attention list; approve or request changes on policy versions; coverage per office; read-only request monitoring (overdue, exception, dispute flags); refunds with simulated payment-provider callbacks (success / failure / duplicate) and outage toggle; JOKRS fee and ledger summary; platform guardrails; unified audit log. |

All three run on the same store: an action in one tab shows up immediately in the others. Customer actions run with role `customer` and platform actions with role `platform` (`Store.dispatchAs`), so permissions, calculation and audit are the same as in the portal. The demo toolbar (simulated time, provider outage, tests, reset) is shared; office and role selectors and scenarios appear only in the office tab. Optional `?view=customer|jokrs|office` opens a view directly; separate windows of the same copy stay in sync through `localStorage`.

## Open it

- Double-click `index.html` (works from `file://` — plain scripts, no modules, no fetch, no build), **or**
- serve the folder: `python -m http.server 8765` inside `cancellation-module/`, then open `http://localhost:8765`.

Data persists in `localStorage` (key `jokrs.crr.demo.v1`), with an in-memory fallback. Malformed saved data is detected and re-seeded without crashing. Use **إعادة ضبط البيانات** in the demo toolbar to reset (with confirmation).

Tajawal is loaded from Google Fonts when online; otherwise it falls back to Segoe UI / Noto Sans Arabic / Tahoma.

## Files

| File | Purpose |
|---|---|
| `engine.js` | Pure rules & money engine (integer halalas, deterministic allocation, Riyadh dates, validation, policy resolution, **the single shared `calculate()`**, customer wording generator, version diff). No DOM. |
| `store.js` | State, persistence, permission-checked actions (`dispatch`), atomic rollback on error, append-only audit, refund state machine, ledger, checkout acceptance. |
| `seed.js` | Three fictional offices; histories produced by running the real store operations at past timestamps; scenarios A–N. |
| `tests.js` | Dependency-free tests (36) for arithmetic and state invariants. `node tests.js` or **تشغيل الفحوصات** in the toolbar (runs on an in-memory copy). |
| `ui-customer.js`, `ui-jokrs.js` | Customer mobile app view and JOKRS platform dashboard view. |
| `ui-core.js`, `ui-pages.js`, `ui-builder.js`, `ui-tools.js`, `app.js` | Vanilla JS UI: shell, router, dialogs, pages, 6-step builder, simulator, phone previews. |
| `index.html`, `styles.css` | Markup shell, inline SVG icon set, RTL responsive styles (1440 / 1024 / 390). |

## Portal sections

نظرة عامة · السياسات · ربط السياسات · طلبات الإلغاء والتعديل · المبالغ المستردة · سجل النشاط, plus office tools **محاكي السياسات** and **معاينة العميل** (embedded phone previews: checkout acceptance + customer cancellation).

The dark **demo toolbar** above the portal (separate from office workflow) switches office, role and simulated Riyadh time, loads scenarios, opens the platform-review fixture (approve/request changes, edit guardrails), toggles a payment-provider outage, runs tests and resets data.

## Three office configurations

| Office | Structure |
|---|---|
| **A — مكتب الندى** (Riyadh) | Single visits + scheduled packages. Time bands per visit (v1: 24h/50%; v2: 12h free, 3–12h 25%, <3h 50% + 15-min grace + partial worker cancel; v3 scheduled at 23 Nov 12:00 with SAR 40 per visit). Package: **fixed fee** for cancelling remaining visits (SAR 100 before start / SAR 200 after), non-stacking with band fees. A package with no valid policy has sales disabled. |
| **B — مؤسسة ركن الراحة** (Jeddah) | Different single and package policies; **SAR 35 per cancelled remaining visit**; 30-minute **booking-time grace**; **reschedule limits by package size** (≤4: 1, ≤8: 2, larger: 3) with a fee after the free change. A pending-review version (consume entitlement) and a rejected version ("changes requested"). Mixed card + wallet payment on a booking whose office funds were already paid out. |
| **C — دار السكينة** (Dammam) | **Flexible visit credits**: eligible cancellation restores the entitlement (no cash); late cancellation consumes it (platform-approved rule); expiry kept on restore, **extended 14 days on office-caused cancellation**; separate rules to refund the package itself (10% before use / SAR 75 after use); expired credits not refundable. An archived single-visit policy replaced via assignment. |

All records (policies, assignments, bookings, requests, refunds, ledger, audit) are isolated per office.

## Implemented workflows

- **Policy lifecycle:** create, view, duplicate, edit draft, submit, publish directly (routine rules) or wait for platform review (restricted rules: consume entitlement, % above thresholds), archive with replacement-or-disable-sales, version history and change comparison. Published versions are immutable; editing creates a new draft. New versions never apply retroactively (past effective dates are rejected).
- **6-step builder:** identity & applicability → customer cancellation (single / selected / all remaining, partial workers, pending-acceptance rule, grace vs. time bands with explicit precedence and inclusive lower bounds, fallback, package fees with explicit percentage bases, caps, non-stacking) → rescheduling (notice, per-visit, by package size, free changes then fee, latest date, repeat rule, late-band lock) → service failure & exceptions (initiator vs. cause) → refunds & generated customer wording (JOKRS fee rules read-only) → review with validation, phone preview and financial simulation.
- **Assignments:** package → service → office default; one complete policy, never merged clauses; type-mismatch and coverage warnings; changes affect new bookings only; drawer of bookings retaining older versions.
- **Requests:** auto-processing for unambiguous rules; review queue; request info; approve per policy; reject with mandatory reason; admin-only waiver bounded by the office fee (never touches JOKRS fees or reduces entitlement); propose alternative date with availability check; simulated customer accept/reject (original slot and original request time preserved); disputed no-shows require written reasons and can be resolved in the customer's favour; exception / rights-based review route whenever automatic processing is denied.
- **Refunds:** states awaiting review → approved → processing → completed / failed, plus not required. Capture refund, authorization release, wallet credit (explicit choice) and entitlement restoration are distinct. Stable operation IDs; duplicate provider callbacks and double clicks have no financial effect; retry after failure; linked ledger entries for office, JOKRS and simulated tax; settlement-recovery entry when office funds were already paid out.
- **Checkout preview:** unchecked acceptance, pay disabled until accepted **and** validated in the action layer; acceptance records customer, booking, policy/version, platform terms and fee-rule versions, text snapshot, time, language; changing the effective version before confirmation invalidates acceptance.
- **Audit:** append-only events with actor, role, timestamp, record and before/after values.

## Calculation scenarios (demo toolbar → سيناريو)

A 425 · B 450 · C one visit only · D grace · E exact band boundary · F office cancellation · G credit restore · H no-show with evidence / disputed · I partial delivery · J promo vs. replacement visit · K old booking keeps v1 · L failed refund + retry · M previous partial refund · N Costing price change. Simulator scenarios show expected results with live pass/fail checks.

## Business decisions that remain configurable

Per office: band boundaries and fees, grace minutes and minimum lead time, pending-acceptance treatment, package fees (type, base, cap) and stacking rule, partial-worker cancellation, reschedule notice/limits/fees/latest date/repeat/lock, arrival tolerance, no-show fee and evidence, refund processing target and day type, review target, wallet option, credit restore notice, late action, expiry handling, package-refund fees, refund-review threshold. Per platform (demo fixture): visit and package fee caps, mandatory grace, consume-entitlement permission, review thresholds, direct-publish permission, JOKRS fee refund rules.

## Assumptions

- Fees are bounded by the eligible amount (no debt model). Rescheduling fees are deducted from the visit's prepaid value.
- Tax adjustment = VAT charged on the refunded service share, pro rata (labelled demo accounting fixture, not tax advice). Retained office fees keep their tax.
- JOKRS fee: refunded on office fault, within grace and before office acceptance; retained on ordinary customer cancellation (demo fixture).
- Mixed payments are returned to each source in proportion to its remaining refundable amount.
- Weekend for business days: Friday and Saturday (Asia/Riyadh, UTC+3, no DST). Office hours for availability: 07:00–22:00.

## Verification performed

- `node tests.js`: 36/36 pass (money allocation, scenarios A–N, boundaries, grace, office fault, credit vs. cash exclusivity, late-band lock, refund idempotency and retry, mixed payments, authorization release, roles in handlers, waiver bounds, immutability, version retention, restricted review, validation, retroactive publish, assignment precedence and coverage, office isolation, checkout acceptance, Costing independence, financial invariants, atomic rollback, append-only audit, malformed storage).
- In the browser (served locally): all sections rendered; scenarios A/H/L run end-to-end; refund process → success → duplicate callback (no extra credit); outage failure → retry → success (credited once); disputed no-show rule; policy draft validation and publish; checkout invalidation at 12:30; platform approval; viewer restrictions; Escape/focus return; reload persistence; no horizontal page overflow at 1440, 1024 and 375 px; no console errors.

## Limitations

- Live-in and overseas recruitment are out of scope (no screens or rules).
- The customer app and JOKRS dashboard are simulations of those surfaces, not the full products. In the simulation each customer belongs to one office. Booking new visits from credits is not modelled.
- Evidence is text only (no file upload). Messages and notifications are not sent.
- Browser `datetime-local` / `date` controls render using the browser's locale.
