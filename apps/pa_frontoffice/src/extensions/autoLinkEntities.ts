/**
 * src/extensions/autoLinkEntities.ts
 *
 * Utility pura per l'auto-linking delle entità MICADO nel Markdown.
 * Porta la logica `markReferences()` + `markReferencesAux()` del legacy
 * (markdownConverterMixin.js) in una funzione TypeScript testabile,
 * senza dipendenze da store o componenti Vue.
 *
 * Funzionamento:
 *   Data una stringa Markdown e una mappa type → entità, scansiona il testo
 *   cercando i titoli delle entità e li avvolge con @[type,id](title), evitando:
 *   - Double-wrapping (mention già esistenti)
 *   - Inserimento dentro link Markdown standard [text](url)
 *   - Deduplicazione per priorità (g > p > i > e) su titoli condivisi
 *
 * @see micado-entities-store.ts  — ENTITY_LINK_PRIORITY
 * @see InternalEntityMention.ts  — buildMentionSyntax, MENTION_REGEX
 */

import { escapeRegExp } from 'lodash-es';
import { logger } from 'src/services/Logger';
import { ENTITY_LINK_PRIORITY, type EntityTypeCode } from 'src/stores/micado-entities-store';
import { buildMentionSyntax, MENTION_REGEX } from './InternalEntityMention';
import type { MicadoEntity } from 'src/api/micado-entities.api';

// ─── Regex di supporto ────────────────────────────────────────────────────────

/**
 * Detecta se il segmento precedente termina con l'apertura di un mention parziale
 * (es. "@[g,5](" prima del testo), per evitare double-wrapping.
 */
const PARTIAL_MENTION_RE = /@\[([^,]+),(\d+)\][（(]/;
const FULL_MENTION_RE = new RegExp(MENTION_REGEX.source);

// ─── Funzione principale ──────────────────────────────────────────────────────

/**
 * Scansiona un Markdown e inserisce i token mention per ogni titolo di entità trovato.
 *
 * @param markdown         - Testo Markdown da processare
 * @param entitiesByType   - Mappa type → array entità (da store.allEntitiesByType)
 * @param userLang         - Codice lingua per Intl.Collator (es. 'en', 'it')
 * @returns                - Markdown con mention inseriti
 */
export function autoLinkEntities(
    markdown: string,
    entitiesByType: Record<EntityTypeCode, MicadoEntity[]>,
    userLang = 'en',
): string {
    if (!markdown) return markdown ?? '';

    const hasAny = ENTITY_LINK_PRIORITY.some(t => entitiesByType[t]?.length > 0);
    if (!hasAny) {
        logger.debug('[autoLinkEntities] nessuna entità, skip');
        return markdown;
    }

    logger.debug('[autoLinkEntities] avvio', {
        mdLen: markdown.length,
        counts: Object.fromEntries(ENTITY_LINK_PRIORITY.map(t => [t, entitiesByType[t]?.length ?? 0])),
    });

    const t0 = performance.now();

    // Comparatore locale: case-insensitive, accent-insensitive
    const collator = new Intl.Collator(userLang, { sensitivity: 'accent' });

    let result = markdown;
    const marked: string[] = []; // Titoli già processati (deduplicazione cross-tipo)

    for (const entityType of ENTITY_LINK_PRIORITY) {
        const entities = entitiesByType[entityType] ?? [];
        if (entities.length === 0) continue;

        // Filtra entità il cui titolo è già stato marcato da un tipo a priorità più alta
        const unique = entities.filter(e => {
            const t = getEntityTitle(e);
            return t.length > 0 && !marked.some(m => collator.compare(m, t) === 0);
        });

        for (const entity of unique) {
            const title = getEntityTitle(entity);
            if (title.length < 2) continue; // Titoli troppo corti → troppe false positive

            result = markTitleInText(result, entityType, entity.id, title, collator);
            marked.push(title.toLowerCase());
        }
    }

    // Pulizia finale: rimuove mention erroneamente inseriti dentro link Markdown
    result = cleanMentionsInsideLinks(result);

    logger.info('[autoLinkEntities] completato', { elapsed: `${Math.round(performance.now() - t0)}ms` });
    return result;
}

// ─── Helper (esportati per i test unitari) ────────────────────────────────────

/**
 * Restituisce il titolo normalizzato di un'entità.
 * I Guided Process usano il campo `process` invece di `title`.
 */
export function getEntityTitle(entity: MicadoEntity): string {
    return entity.process ?? entity.title ?? '';
}

/**
 * Cerca le occorrenze di `title` nel `text` e le avvolge con la sintassi mention.
 * Evita il double-wrapping controllando il segmento precedente a ogni match.
 */
export function markTitleInText(
    text: string,
    entityType: EntityTypeCode,
    entityId: number,
    title: string,
    collator: Intl.Collator,
): string {
    const escaped = escapeRegExp(title);
    const titleRe = new RegExp(`(${escaped})`, 'gi');
    const parts = text.split(titleRe);

    if (parts.length <= 1) return text;

    for (let i = 0; i < parts.length; i++) {
        const part = parts[i]!;
        if (collator.compare(part, title) !== 0) continue;

        if (i === 0) {
            // Inizio testo: nessun contesto precedente, wrappa sempre
            parts[i] = buildMentionSyntax(entityType, entityId, part);
        } else {
            const prev = parts[i - 1]!;
            // Non wrappare se siamo già dentro un mention parziale aperto
            const isInsidePartial = PARTIAL_MENTION_RE.test(prev) && !FULL_MENTION_RE.test(prev);
            if (!isInsidePartial) {
                parts[i] = buildMentionSyntax(entityType, entityId, part);
                logger.debug('[autoLinkEntities] marcato', { title, type: entityType, id: entityId });
            }
        }
    }

    return parts.join('');
}

/**
 * Rimuove mention erroneamente inseriti dentro link Markdown standard.
 *
 * Caso problematico:
 *   [asylum seeker](https://example.com)
 *   → [@[g,5](asylum seeker)](https://example.com)   ← invalido
 *   → [asylum seeker](https://example.com)            ← ripristinato
 *
 * Porta la logica `removeReferencesFromExternalLinks()` del legacy.
 */
export function cleanMentionsInsideLinks(text: string): string {
    return text.replace(
        /\[([^\]]*@\[[^\]]+\]\([^)]+\)[^\]]*)\]\(([^)]+)\)/g,
        (_match, linkText: string, url: string) => {
            const clean = linkText.replace(/@\[[^\]]+\]\(([^)]+)\)/g, '$1');
            logger.debug('[autoLinkEntities] rimosso mention da link', { url });
            return `[${clean}](${url})`;
        },
    );
}