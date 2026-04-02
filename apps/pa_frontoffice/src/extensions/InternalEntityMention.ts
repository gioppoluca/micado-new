/**
 * src/extensions/InternalEntityMention.ts
 *
 * TipTap v3 Mark extension — renders existing @[type,id](text) mentions from DB.
 *
 * This file is ONLY the Mark definition (rendering + MD serialization).
 * The interactive @ Suggestion plugin lives in InternalEntityMentionSuggestion.ts.
 * Register BOTH in RichTextEditor.vue extensions[].
 *
 * @see InternalEntityMentionSuggestion.ts  — the @ trigger + popup
 * @see InternalEntityMentionView.vue        — Vue component for the span
 */

import { Mark } from '@tiptap/core';
import { VueMarkViewRenderer } from '@tiptap/vue-3';
import { logger } from 'src/services/Logger';
import InternalEntityMentionView from './InternalEntityMentionView.vue';
import type { EntityTypeCode } from 'src/stores/micado-entities-store';

// ─── Regex ────────────────────────────────────────────────────────────────────

/** Matches @[type,id](text) — groups: type, id, text. */
export const MENTION_REGEX = /@\[([^,]+),(\d+)\][（(]([^）)]+)[）)]/g;
export const MENTION_REGEX_SINGLE = /@\[([^,]+),(\d+)\][（(]([^）)]+)[）)]/;

export function buildMentionSyntax(type: EntityTypeCode, id: number, text: string): string {
    return `@[${type},${id}](${text})`;
}

export function extractMentions(markdown: string): Array<{ type: string; id: number; text: string }> {
    const matches: Array<{ type: string; id: number; text: string }> = [];
    const re = new RegExp(MENTION_REGEX.source, 'g');
    let m: RegExpExecArray | null;
    while ((m = re.exec(markdown)) !== null) {
        matches.push({ type: m[1]!, id: parseInt(m[2]!, 10), text: m[3]! });
    }
    return matches;
}

// ─── Mark ─────────────────────────────────────────────────────────────────────

const InternalEntityMention = Mark.create({
    name: 'internalmention',

    inclusive: false,

    addAttributes() {
        return {
            entityType: {
                default: null as EntityTypeCode | null,
                parseHTML: (el: HTMLElement) => el.getAttribute('data-entity-type') as EntityTypeCode | null,
                renderHTML: (attrs: Record<string, unknown>) => ({ 'data-entity-type': attrs['entityType'] }),
            },
            entityId: {
                default: null as number | null,
                parseHTML: (el: HTMLElement) => {
                    const raw = el.getAttribute('data-entity-id');
                    return raw ? parseInt(raw, 10) : null;
                },
                renderHTML: (attrs: Record<string, unknown>) => ({ 'data-entity-id': attrs['entityId'] }),
            },
        };
    },

    parseHTML() {
        return [
            { tag: 'span[data-entity-type]' },
            // Backward compat with legacy HTML saved in DB
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

    renderHTML({ HTMLAttributes }) {
        return ['span', { class: 'micado-mention', ...HTMLAttributes }, 0];
    },

    /** tiptap-markdown: serialize @[type,id](text) — open writes prefix, close writes suffix. */
    addStorage() {
        return {
            markdown: {
                serialize: {
                    /**
                     * Called before the mark's text content.
                     * Writes "@[type,id](" — the text node fills in between.
                     */
                    open(_state: unknown, mark: { attrs: Record<string, unknown> }) {
                        const type = mark.attrs['entityType'] as string;
                        const id = mark.attrs['entityId'] as number;
                        logger.debug('[InternalEntityMention] serialize open', { type, id });
                        return `@[${type},${id}](`;
                    },
                    /** Called after the mark's text content. Closes the syntax. */
                    close: ')',
                    expelEnclosingWhitespace: false,
                },
            },
        };
    },

    /** Delegates visual rendering to InternalEntityMentionView.vue */
    addMarkView() {
        return VueMarkViewRenderer(InternalEntityMentionView);
    },
});

export default InternalEntityMention;