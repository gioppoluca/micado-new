SET search_path TO micado;

BEGIN;

-- ============================================================================
-- EXAMPLE INFORMATION
-- ============================================================================
INSERT INTO content_item (type_code, external_key, slug)
VALUES ('INFORMATION', 'information-example-001', 'welcome-to-micado');

INSERT INTO content_revision (
  item_id,
  revision_no,
  status,
  source_lang,
  data_extra,
  published_at
)
SELECT
  ci.id,
  1,
  'PUBLISHED',
  'it',
  jsonb_build_object(
    'link', 'https://www.example.org/micado/welcome',
    'publication_date', '2026-04-12'
  ),
  NOW()
FROM content_item ci
WHERE ci.type_code = 'INFORMATION'
  AND ci.external_key = 'information-example-001';

INSERT INTO content_revision_translation (
  revision_id,
  lang,
  title,
  description,
  t_status
)
SELECT
  cr.id,
  'it',
  'Benvenuto in Micado',
  '<p>Micado è una piattaforma informativa pensata per aiutarti a trovare servizi, informazioni utili ed eventi sul territorio.</p><p>In questa sezione puoi consultare contenuti pubblicati dagli operatori in modo semplice e chiaro.</p>',
  'PUBLISHED'
FROM content_item ci
JOIN content_revision cr ON cr.item_id = ci.id
WHERE ci.type_code = 'INFORMATION'
  AND ci.external_key = 'information-example-001'
  AND cr.revision_no = 1;

INSERT INTO content_revision_translation (
  revision_id,
  lang,
  title,
  description,
  t_status
)
SELECT
  cr.id,
  'en',
  'Welcome to Micado',
  '<p>Micado is an information platform designed to help you find services, useful information, and local events.</p><p>In this section you can browse content published by operators in a simple and clear way.</p>',
  'PUBLISHED'
FROM content_item ci
JOIN content_revision cr ON cr.item_id = ci.id
WHERE ci.type_code = 'INFORMATION'
  AND ci.external_key = 'information-example-001'
  AND cr.revision_no = 1;

INSERT INTO content_revision_translation (
  revision_id,
  lang,
  title,
  description,
  t_status
)
SELECT
  cr.id,
  'de',
  'Willkommen bei Micado',
  '<p>Micado ist eine Informationsplattform, die dir hilft, Dienstleistungen, nützliche Informationen und lokale Veranstaltungen zu finden.</p><p>In diesem Bereich kannst du Inhalte durchsuchen, die von den Betreibern einfach und klar veröffentlicht wurden.</p>',
  'PUBLISHED'
FROM content_item ci
JOIN content_revision cr ON cr.item_id = ci.id
WHERE ci.type_code = 'INFORMATION'
  AND ci.external_key = 'information-example-001'
  AND cr.revision_no = 1;

UPDATE content_item ci
SET published_revision_id = cr.id
FROM content_revision cr
WHERE ci.id = cr.item_id
  AND ci.type_code = 'INFORMATION'
  AND ci.external_key = 'information-example-001'
  AND cr.revision_no = 1;

-- ============================================================================
-- EXAMPLE EVENT
-- ============================================================================
INSERT INTO content_item (type_code, external_key, slug)
VALUES ('EVENT', 'event-example-001', 'orientation-day');

INSERT INTO content_revision (
  item_id,
  revision_no,
  status,
  source_lang,
  data_extra,
  published_at
)
SELECT
  ci.id,
  1,
  'PUBLISHED',
  'it',
  jsonb_build_object(
    'start_date', '2026-05-10T09:30:00+02:00',
    'end_date', '2026-05-10T12:30:00+02:00',
    'location', 'Centro Servizi Micado - Torino',
    'cost', 'Gratuito',
    'publication_date', '2026-04-12'
  ),
  NOW()
FROM content_item ci
WHERE ci.type_code = 'EVENT'
  AND ci.external_key = 'event-example-001';

INSERT INTO content_revision_translation (
  revision_id,
  lang,
  title,
  description,
  t_status
)
SELECT
  cr.id,
  'it',
  'Giornata di orientamento ai servizi',
  '<p>Un incontro dedicato a presentare i principali servizi disponibili per i nuovi arrivati.</p><p>Durante l’evento saranno illustrati i servizi amministrativi, sanitari e di supporto linguistico presenti sul territorio.</p>',
  'PUBLISHED'
FROM content_item ci
JOIN content_revision cr ON cr.item_id = ci.id
WHERE ci.type_code = 'EVENT'
  AND ci.external_key = 'event-example-001'
  AND cr.revision_no = 1;

INSERT INTO content_revision_translation (
  revision_id,
  lang,
  title,
  description,
  t_status
)
SELECT
  cr.id,
  'en',
  'Service orientation day',
  '<p>A meeting dedicated to presenting the main services available for newcomers.</p><p>During the event, administrative, health, and language support services available in the area will be explained.</p>',
  'PUBLISHED'
FROM content_item ci
JOIN content_revision cr ON cr.item_id = ci.id
WHERE ci.type_code = 'EVENT'
  AND ci.external_key = 'event-example-001'
  AND cr.revision_no = 1;

INSERT INTO content_revision_translation (
  revision_id,
  lang,
  title,
  description,
  t_status
)
SELECT
  cr.id,
  'de',
  'Orientierungstag zu den Diensten',
  '<p>Ein Treffen, das der Vorstellung der wichtigsten verfügbaren Dienste für neu angekommene Personen gewidmet ist.</p><p>Während der Veranstaltung werden Verwaltungs-, Gesundheits- und Sprachunterstützungsdienste in der Region vorgestellt.</p>',
  'PUBLISHED'
FROM content_item ci
JOIN content_revision cr ON cr.item_id = ci.id
WHERE ci.type_code = 'EVENT'
  AND ci.external_key = 'event-example-001'
  AND cr.revision_no = 1;

UPDATE content_item ci
SET published_revision_id = cr.id
FROM content_revision cr
WHERE ci.id = cr.item_id
  AND ci.type_code = 'EVENT'
  AND ci.external_key = 'event-example-001'
  AND cr.revision_no = 1;

-- ============================================================================
-- EXAMPLE GLOSSARY
-- ============================================================================
INSERT INTO content_item (type_code, external_key, slug)
VALUES ('GLOSSARY', 'glossary-example-001', 'residence-permit');

INSERT INTO content_revision (
  item_id,
  revision_no,
  status,
  source_lang,
  data_extra,
  published_at
)
SELECT
  ci.id,
  1,
  'PUBLISHED',
  'it',
  jsonb_build_object(
    'publication_date', '2026-04-12'
  ),
  NOW()
FROM content_item ci
WHERE ci.type_code = 'GLOSSARY'
  AND ci.external_key = 'glossary-example-001';

INSERT INTO content_revision_translation (
  revision_id,
  lang,
  title,
  description,
  t_status
)
SELECT
  cr.id,
  'it',
  'Permesso di soggiorno',
  '<p>Documento rilasciato dalle autorità competenti che consente a una persona straniera di soggiornare regolarmente in Italia per un determinato periodo e motivo.</p>',
  'PUBLISHED'
FROM content_item ci
JOIN content_revision cr ON cr.item_id = ci.id
WHERE ci.type_code = 'GLOSSARY'
  AND ci.external_key = 'glossary-example-001'
  AND cr.revision_no = 1;

INSERT INTO content_revision_translation (
  revision_id,
  lang,
  title,
  description,
  t_status
)
SELECT
  cr.id,
  'en',
  'Residence permit',
  '<p>A document issued by the competent authorities that allows a foreign person to stay legally in Italy for a specific period and reason.</p>',
  'PUBLISHED'
FROM content_item ci
JOIN content_revision cr ON cr.item_id = ci.id
WHERE ci.type_code = 'GLOSSARY'
  AND ci.external_key = 'glossary-example-001'
  AND cr.revision_no = 1;

INSERT INTO content_revision_translation (
  revision_id,
  lang,
  title,
  description,
  t_status
)
SELECT
  cr.id,
  'de',
  'Aufenthaltserlaubnis',
  '<p>Ein von den zuständigen Behörden ausgestelltes Dokument, das einer ausländischen Person erlaubt, sich für einen bestimmten Zeitraum und aus einem bestimmten Grund rechtmäßig in Italien aufzuhalten.</p>',
  'PUBLISHED'
FROM content_item ci
JOIN content_revision cr ON cr.item_id = ci.id
WHERE ci.type_code = 'GLOSSARY'
  AND ci.external_key = 'glossary-example-001'
  AND cr.revision_no = 1;

UPDATE content_item ci
SET published_revision_id = cr.id
FROM content_revision cr
WHERE ci.id = cr.item_id
  AND ci.type_code = 'GLOSSARY'
  AND ci.external_key = 'glossary-example-001'
  AND cr.revision_no = 1;

COMMIT;