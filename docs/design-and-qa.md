# Studio design and verification

Studio is the selected design for timenow. The comparison toolbar, alternate layouts, their assets, and their component-library dependencies have been removed. Radix Themes supplies the shared controls directly.

## Design

- White page and surfaces, indigo accent (`#635bdf` / Radix iris), pale side rail, and fine neutral borders.
- Inter typography, tabular durations, and consistent Lucide outline icons.
- Desktop: side navigation, open entry ledger, compact form to the right.
- Mobile: form first, fixed bottom navigation, single-column fields on narrow phones.
- Today, Unbilled, History, and Settings retain the existing sample-data workflows.

The [selected visual reference](concepts/studio.png) predates removal of the design comparison bar. Current previews: [desktop](previews/studio-desktop.png) and [mobile](previews/studio-mobile.png).

The app uses simple screen routes. Existing Studio preview links resolve to the corresponding screen. The database connection update replaces browser-local storage and removes demo reset; the older verification below describes the prototype before that change.

## Prototype verification (historical)

The flow under test is: open timenow directly → use the four screens → add/edit/void time through Radix controls → inspect the resulting totals/history. Also check the relocated demo reset and an existing Studio link.

`npm run build` passes. All four screens were checked at 320, 375, 390, 768, 1024, and 1440px (24 combinations): correct titles, meaningful content, no horizontal overflow, and no framework overlay or browser console errors. The desktop sidebar starts at the top of the viewport, and mobile navigation remains anchored at the bottom.

Interaction checks passed: create `1h30` → edit it to `45m` → see the resulting history → reset the sample data from Settings. The old Studio Unbilled link resolves to `#/unbilled`. Checks used a fresh isolated browser session, so existing demo records in the user's browser were preserved.

T3 navigation and DOM inspection worked, but screenshot capture repeatedly returned `Preview automation snapshot timed out after 15000ms.` Visual and interaction verification therefore used the existing Playwright Chromium installation, without adding a project test dependency. Mobile sizes are Chromium emulation, not physical-device Safari testing.

The screenshots were inspected against the selected Studio reference for palette, typography, the side rail, the ledger/form arrangement, controls, and responsive spacing. Intentional changes: the comparison bar and its viewport offsets are gone, navigation uses simple screen routes, and demo reset lives in Settings. The compact typography and functional native date inputs from the Studio implementation are retained. No unresolved layout issue was found in the checked sizes.

## PostgreSQL connection verification — 2026-10-30

The existing Studio UI now uses the local Node API and PostgreSQL. A fresh database is empty; old browser-local sample data is not imported or removed. Settings no longer offers destructive demo reset. The footer identifies server persistence. Invoice reference is optional, and the billing action records hours invoiced in another tool.

`npm run build` and all six `npm run test:integration` suites pass against PostgreSQL 17. Tests use a temporary schema that is removed afterward. Coverage includes committed persistence through a separate connection, entry editing/voiding with before/after audit, stale version rejection, archived customers, input validation, actor spoof rejection, atomic bulk rollback, optional rates/references, mixed-customer batch rejection, concurrent double billing, database constraints and history protection, audit failure rollback, and cross-site request rejection.

Browser plugin not available; validation used the available Playwright connector in a fresh context. Its API calls were routed to an isolated test schema, leaving the real workspace empty. Flow: create customer → create project → create 90m entry → edit to 45m → reload and retain 45m → mark billed without rate or invoice reference → create and void another entry → inspect history. Page identity and meaningful content passed; no framework overlay, console errors, or page errors were observed. Screenshots were captured outside the repository at 1440×900 and 390×844; mobile had no horizontal overflow. These are Chromium checks, not physical-device Safari checks. The test context and API were closed and the schema removed.

Authentication and Railway deployment remain unimplemented. The development API is loopback-only and rejects production mode until authentication is added.
