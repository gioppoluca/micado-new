// src/controllers/index.ts
//
// Central re-export barrel for all LoopBack 4 controllers.
// The boot artifact (bootOptions.controllers) discovers *.controller.js
// from the compiled output, but this barrel also allows explicit imports
// between modules without path fragility.
//
// ── Organisation ─────────────────────────────────────────────────────────────
//
//   Core content-type controllers (PA back-office)
//   Webhook receivers (external system integrations)
//   Utility / meta controllers
//   DEV-only controllers (must be guarded / removed before production)
//

// ── Core content types ────────────────────────────────────────────────────────
export * from './ping.controller';
export * from './public-settings.controller';
export * from './language.controller';
export * from './user-types.controller';
export * from './feature-flag.controller';
export * from './active-features.controller';
export * from './document-types.controller';
export * from './topics.controller';
export * from './glossaries.controller';
export * from './categories.controller';
export * from './events.controller';
export * from './information.controller';
export * from './processes.controller';

// ── Webhook receivers ─────────────────────────────────────────────────────────
//
// WeblateWebhookController:
//   POST /api/webhooks/weblate/translation-complete
//   Called by Weblate add-on when a translation is saved.
//   Verifies HMAC, pulls catalog from Gitea, signals DBOS child workflows.
//
export * from './webhooks/weblate.controller';

// ── DEV controllers ──────────────────────────────────────────────────────────
// ⚠  Remove or guard with IS_PRODUCTION check before deploying to production.
//    These endpoints bypass all authorization.
export * from './dev/translation-workflow-test.controller';