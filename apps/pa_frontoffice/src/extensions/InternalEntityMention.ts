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

                /**
                 * parse.setup: registers a markdown-it inline rule that fires
                 * BEFORE the built-in 'link' rule, preventing markdown-it from
                 * interpreting @[g,1](test) as the markdown link [g,1](test)
                 * preceded by the literal character @.
                 *
                 * ── Why ruler.before('link') ─────────────────────────────────
                 * markdown-it parses `[label](url)` as a link. Our syntax
                 * `@[type,id](text)` matches that pattern — markdown-it produces
                 * `@<a href="text">type,id</a>` for single-word text values,
                 * causing the visible `@g,1` artefact.
                 * Registering before the 'link' rule gives us first pick.
                 *
                 * ── Why html_inline tokens work with html:false ───────────────
                 * Markdown.configure({ html: false }) blocks user-authored HTML
                 * in the source text, but does NOT filter html_inline tokens
                 * emitted by internal inline rules — those always pass through.
                 * Verified with markdown-it source and confirmed by runtime test.
                 *
                 * ── Full pipeline ─────────────────────────────────────────────
                 *   @[g,1](Permesso di soggiorno)     ← Markdown from DB
                 *   → parse.setup inline rule fires first
                 *   → emits html_inline token:
                 *       <span data-entity-type="g" data-entity-id="1">
                 *         Permesso di soggiorno
                 *       </span>
                 *   → ProseMirror parseHTML() matches span[data-entity-type]
                 *   → creates internalmention mark node with attrs + text content
                 *   → VueMarkViewRenderer mounts InternalEntityMentionView.vue
                 *   → <mark-view-content /> renders "Permesso di soggiorno"
                 *   → displayed as styled clickable link
                 */
                parse: {
                    setup(md: {
                        inline: {
                            ruler: {
                                before(
                                    beforeRule: string,
                                    ruleName: string,
                                    fn: (
                                        state: {
                                            src: string;
                                            pos: number;
                                            push(type: string, tag: string, nesting: number): { content: string };
                                        },
                                        silent: boolean,
                                    ) => boolean,
                                ): void;
                            };
                        };
                    }) {
                        // Must match exactly at state.pos — anchored via slice
                        const MENTION_RE = /^@\[([^\],]+),(\d+)\]\(([^)]+)\)/;

                        md.inline.ruler.before('link', 'internalmention', (state, silent) => {
                            const src = state.src.slice(state.pos);
                            const m = MENTION_RE.exec(src);
                            if (!m) return false;

                            if (!silent) {
                                // Emit raw HTML span — passes through even with html:false
                                // because it is produced by an internal rule, not user input.
                                const token = state.push('html_inline', '', 0);
                                token.content = `<span data-entity-type="${m[1]}" data-entity-id="${m[2]}">${m[3]}</span>`;
                                logger.debug('[InternalEntityMention] parse: mention → span', {
                                    type: m[1], id: m[2], text: m[3],
                                });
                            }

                            state.pos += m[0].length;
                            return true;
                        });
                    },
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