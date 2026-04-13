// src/controllers/index.ts
//
// Central barrel for all LoopBack 4 controllers.
// The boot artifact (bootOptions.controllers) discovers *.controller.js
// from the compiled dist/, but this barrel allows clean explicit imports.
//
// ── Content-type controllers (PA / NGO back-office) ──────────────────────────
export * from './ping.controller';
export * from './public-settings.controller';
export * from './active-features.controller';
export * from './language.controller';
export * from './feature-flag.controller';
export * from './document-types.controller';
export * from './topics.controller';
export * from './glossaries.controller';
export * from './categories.controller';
export * from './events.controller';
export * from './information.controller';
export * from './processes.controller';
export * from './user-types.controller';

// ── Webhook receivers ─────────────────────────────────────────────────────────
//
// TranslationCommittedController
//   POST /api/webhooks/weblate/translation-committed
//   Installed as a per-component addon (events: [17] = COMMIT).
//   Stores the incoming payload in weblate_commit_event (status=NEW).
//   Gitea does NOT have the content yet at this point.
//
// TranslationPushedController
//   POST /api/webhooks/weblate/translation-pushed
//   Installed as a project-level addon (events: [18] = PUSH).
//   Gitea HAS the final content at this point.
//   Atomically claims staged NEW rows (SELECT FOR UPDATE SKIP LOCKED),
//   pulls Gitea catalogs per language, signals DBOS child workflows,
//   deletes processed rows by workerHash.
//
export * from './webhooks/translation-committed.controller';
export * from './webhooks/translation-pushed.controller';

// ── DEV controllers ──────────────────────────────────────────────────────────
// ⚠  Remove or guard with NODE_ENV check before production.
//    These endpoints bypass all authorization.
export * from './dev/translation-workflow-test.controller';