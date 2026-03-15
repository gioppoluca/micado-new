/**
 * src/extensions/InternalEntityMention.ts
 *
 * Estensione TipTap v3 per i link interni alle entità MICADO.
 * Rimpiazza InternalMention.js del legacy (TipTap v1, class-based).
 *
 * Definisce il mark `internalmention` con la sintassi:
 *   @[type,id](display text)
 *
 * Dove type ∈ { g, i, p, e }
 *
 * Cosa fa questa estensione:
 *  1. Definisce gli attributi del mark: entityType e entityId
 *  2. Gestisce il parsing HTML (caricamento contenuto salvato)
 *  3. Gestisce il rendering HTML (serializzazione)
 *  4. Integra tiptap-markdown per import/export Markdown della sintassi custom
 *  5. Delega il rendering visuale a InternalEntityMentionView.vue (VueMarkViewRenderer)
 *
 * @see InternalEntityMentionView.vue  — componente Vue dello span cliccabile
 * @see autoLinkEntities.ts            — utility per l'auto-linking al salvataggio
 * @see micado-entities-store.ts       — store con i dati delle entità
 */

import { Mark } from '@tiptap/core';
import { VueMarkViewRenderer } from '@tiptap/vue-3';
import { logger } from 'src/services/Logger';
import InternalEntityMentionView from './InternalEntityMentionView.vue';
import type { EntityTypeCode } from 'src/stores/micado-entities-store';

// ─── Regex per la sintassi @[type,id](text) ───────────────────────────────────

/**
 * Cattura tre gruppi: tipo entità, id numerico, testo visualizzato.
 * Supporta parentesi ASCII ( ) e full-width （ ） per compatibilità CJK
 * (retrocompatibilità con il database del legacy).
 *
 * @example "@[g,5](asylum seeker)" → groups: ['g', '5', 'asylum seeker']
 */
export const MENTION_REGEX = /@\[([^,]+),(\d+)\][（(]([^）)]+)[）)]/g;

/** Versione non-global per test singoli match */
export const MENTION_REGEX_SINGLE = /@\[([^,]+),(\d+)\][（(]([^）)]+)[）)]/;

/**
 * Genera la sintassi Markdown per un mention.
 * @example buildMentionSyntax('g', 5, 'asylum seeker') → "@[g,5](asylum seeker)"
 */
export function buildMentionSyntax(type: EntityTypeCode, id: number, text: string): string {
    return `@[${type},${id}](${text})`;
}

/**
 * Estrae tutti i mention da una stringa Markdown.
 */
export function extractMentions(markdown: string): Array<{ type: string; id: number; text: string }> {
    const matches: Array<{ type: string; id: number; text: string }> = [];
    const regex = new RegExp(MENTION_REGEX.source, 'g');
    let match: RegExpExecArray | null;
    while ((match = regex.exec(markdown)) !== null) {
        matches.push({ type: match[1]!, id: parseInt(match[2]!, 10), text: match[3]! });
    }
    return matches;
}

// ─── Definizione estensione ───────────────────────────────────────────────────

const InternalEntityMention = Mark.create({
    name: 'internalmention',

    /**
     * Il mark NON è inclusive: il cursore dopo lo span non eredita il mark,
     * così il testo digitato dopo un mention è normale.
     */
    inclusive: false,

    /** Attributi persistiti nel documento ProseMirror */
    addAttributes() {
        return {
            /**
             * Tipo entità: 'g' | 'i' | 'p' | 'e'
             * Corrisponde a `mention-type` del legacy.
             */
            entityType: {
                default: null as EntityTypeCode | null,
                parseHTML: (el: HTMLElement) => el.getAttribute('data-entity-type') as EntityTypeCode | null,
                renderHTML: (attrs: Record<string, unknown>) => ({
                    'data-entity-type': attrs['entityType'],
                }),
            },

            /**
             * ID numerico dell'entità nel DB.
             * Corrisponde a `data-mention-id` del legacy.
             */
            entityId: {
                default: null as number | null,
                parseHTML: (el: HTMLElement) => {
                    const raw = el.getAttribute('data-entity-id');
                    return raw ? parseInt(raw, 10) : null;
                },
                renderHTML: (attrs: Record<string, unknown>) => ({
                    'data-entity-id': attrs['entityId'],
                }),
            },
        };
    },

    /**
     * Parsing HTML → ProseMirror.
     * Riconosce la nuova classe `micado-mention` e per retrocompatibilità
     * anche la vecchia classe `mention` del legacy.
     */
    parseHTML() {
        return [
            { tag: 'span[data-entity-type]' },
            // Retrocompatibilità con HTML salvato dal legacy
            {
                tag: 'span[mention-type]',
                getAttrs: (el: HTMLElement | string): Record<string, unknown> | false => {
                    if (typeof el === 'string') return false;
                    return {
                        entityType: el.getAttribute('mention-type'),
                        entityId: parseInt(el.getAttribute('data-mention-id') ?? '0', 10),
                    };
                },
            },
        ];
    },

    /** Rendering ProseMirror → HTML */
    renderHTML({ HTMLAttributes }) {
        return ['span', { class: 'micado-mention', ...HTMLAttributes }, 0];
    },

    /**
     * Integrazione con tiptap-markdown.
     * Definisce come serializzare e parsare questo mark in Markdown.
     *
     * La sintassi è: @[type,id](testo visualizzato)
     *
     * NOTA: tiptap-markdown gestisce la serializzazione tramite lo storage `markdown`.
     * Quando passeremo a @tiptap/markdown ufficiale la struttura sarà simile
     * ma con un'API leggermente diversa (createInlineMarkdownSpec).
     */
    addStorage() {
        return {
            markdown: {
                /**
                 * Serializzatore Markdown: genera @[type,id](text) invece dello span HTML.
                 * Lo `state` è il MarkdownSerializerState di tiptap-markdown.
                 */
                serialize(state: { write: (s: string) => void }, mark: { attrs: Record<string, unknown> }, node: { textContent: string }) {
                    const type = mark.attrs['entityType'] as EntityTypeCode;
                    const id = mark.attrs['entityId'] as number;
                    const text = node.textContent;
                    const syntax = buildMentionSyntax(type, id, text);
                    logger.debug('[InternalEntityMention] MD serialize', { type, id, text });
                    state.write(syntax);
                },
                // open/close vuoti: la serializzazione è interamente custom sopra
                open: '',
                close: '',
            },
        };
    },

    /**
     * VueMarkViewRenderer: delega il rendering visuale a InternalEntityMentionView.vue.
     * Questo è il rimpiazzo del Plugin ProseMirror click-handler del legacy.
     * Il componente Vue ha accesso allo store Pinia e gestisce click, tooltip, ecc.
     */
    addMarkView() {
        logger.debug('[InternalEntityMention] addMarkView registrato');
        return VueMarkViewRenderer(InternalEntityMentionView);
    },
});

export default InternalEntityMention;