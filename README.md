# WPC Hub

A standalone Workforce Planning Committee workspace designed to replace the Claude-dependent prototype while keeping the same business flow:

- agenda preparation and item tracking
- live minute-taking and conflict-safe editing
- routing and review workflow
- actions, signatures, dashboard, and audit trail

## Quick start

1. Open `index.html` in a browser, or serve the folder with a local static server.
2. The app stores data in `localStorage` by default, so it works without Claude.
3. Use the seeded demo data or start creating items and meetings.

## Included

- `index.html` — app shell
- `css/app.css` — design system and responsive UI
- `js/domain.js` — core workflow rules and validation
- `js/store.js` — standalone data adapter with localStorage fallback
- `js/ui.js` — shared UI helpers
- `js/views.js` — dashboard and workflow views
- `js/app.js` — routing and commands
- `tests/domain.test.mjs` — unit tests for business rules
- `seed.json` — example data

## Notes

This project keeps the same WPC business logic as the original prototype while removing the dependency on the Claude runtime. It is ideal as the first step before connecting production data and real email/signature integrations.
