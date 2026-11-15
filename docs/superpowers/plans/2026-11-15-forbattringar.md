# Fem förbättringar – plan

> Utförs inline (superpowers:executing-plans). Spec: `docs/superpowers/specs/2026-11-15-forbattringar-design.md`

**Global:** svenska texter; personaltexter (Matsal) via i18n i alla 16 språk (`Dict` kräver alla nycklar);
ägartexter i installationen bara på svenska som resten av sidan. Testbara moduler importerar inget med `@/`.
Tester: `cd web && node --test tests/` + `npx tsc --noEmit && npx eslint .`

## Task 1: Testkörning för webbappen + stegräkning (punkt 5)
- Create `web/lib/setupProgress.ts`: `SETUP_STEPS` (id, label, minutes), `progress(stepId) -> {index, total, label, minutes}`,
  `requiredDone(step) -> number` (0–4, `done` → 4).
- Create `web/tests/setupProgress.test.mjs`; `package.json` script `"test": "node --test tests/"`.
- Modify `app/setup/page.tsx`: mobil "Steg X av Y" + stapel + minuter; STEPS från `SETUP_STEPS`.
- Modify `SetupGate.tsx`: "X av 4 steg klara" (ny nyckel `gate.progress`), demo-länk kommer i Task 3.

## Task 2: Färgförklaring (punkt 7)
- Create `web/app/components/ColorGuide.tsx` (modal, localStorage `bordvakt.colorGuideSeen`, try/catch).
- Nycklar `guide.*` i alla språk. "?"-knapp i `DiningRoomMap` vid legenden; visas automatiskt första gången i Matsalen.

## Task 3: Demoläge (punkt 2)
- Create `web/lib/demo.ts`: `demoPlan`, `demoTables(tick)`, `demoTasks(tick)`, `demoOrders(tick)` — deterministiska.
- Test `web/tests/demo.test.mjs`: 8 bord, status ändras mellan tick, samma tick → samma data, alla bord har plats på planen.
- `app/matsal/page.tsx`: `?demo=1` → `DemoDashboard` som matar `DashboardView`; demorad överst.
- SetupGate + installationssidan: länk "Se hur det ser ut (demo)". SetupGate visas inte när `demo=1`.

## Task 4: Offline + kö (punkt 4)
- Create `web/lib/offlineQueue.ts`: `enqueue(list, action, now)`, `fresh(list, now)` (15 min), `drain(list, send)`
  där `send` returnerar `'ok'|'gone'|'retry'`.
- Test `web/tests/offlineQueue.test.mjs`: dedupe per id, gamla slängs, ok/gone tas bort, retry blir kvar och stoppar.
- `web/lib/useOfflineQueue.ts`: online-status, localStorage, töm vid `online` och när realtiden kopplas upp.
- Matsal: `completeTask` och "serverad" köas vid offline/nätverksfel; gul rad i `DashboardView` med tid och antal.

## Task 5: Sammanfattning efter passet (punkt 6)
- Create `web/app/components/ShiftSummary.tsx`: knapp + modal, hämtar `/api/stats?from=<idag>&to=<idag>`.
- Nycklar `shift.*` i alla språk. Knappen i `DashboardView` (inte i demon: där visas låtsassiffror).

Varje task: tsc + eslint + node-tester, webbläsarkoll i mobil/dator, egen commit.
