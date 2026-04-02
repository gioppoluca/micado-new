/**
 * src/extensions/InternalEntityMentionSuggestion.ts
 *
 * Standalone TipTap Extension that adds the @ Suggestion plugin.
 *
 * WHY THIS IS A SEPARATE EXTENSION (not inside the Mark):
 * ─────────────────────────────────────────────────────────
 * A Mark.addProseMirrorPlugins() receives `this.editor` at schema-build time,
 * before the editor view exists. The Suggestion plugin needs the editor VIEW
 * (for coordsAtPos and DOM queries). Registering Suggestion inside a Mark
 * causes it to fail silently because the editor view is not yet attached.
 *
 * The solution is a separate Extension.create() — Extensions are instantiated
 * after the view is mounted, so `this.editor` is fully operational.
 *
 * Register BOTH in useEditor:
 *   extensions: [
 *     InternalEntityMention,             // Mark — renders @[type,id](text)
 *     InternalEntityMentionSuggestion,   // Extension — handles @ typing
 *   ]
 *
 * @see InternalEntityMention.ts  — the Mark definition
 * @see RichTextEditor.vue        — where both are registered
 */

import { Extension } from '@tiptap/core';
import { Suggestion, type SuggestionProps } from '@tiptap/suggestion';
import { PluginKey } from '@tiptap/pm/state';
import { createApp, defineComponent, ref, h, type App } from 'vue';
import { logger } from 'src/services/Logger';
import { useMicadoEntitiesStore } from 'src/stores/micado-entities-store';
import type { EntityTypeCode } from 'src/stores/micado-entities-store';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface MentionSuggestionItem {
    entityType: EntityTypeCode;
    entityId: number;
    label: string;
}

const TYPE_LABELS: Record<EntityTypeCode, string> = {
    g: 'Glossary',
    p: 'Process',
    i: 'Info',
    e: 'Event',
};

// ─── Popup (minimal inline Vue app, no Tippy) ─────────────────────────────────

function mountPopup(
    items: MentionSuggestionItem[],
    onSelect: (item: MentionSuggestionItem) => void,
): { el: HTMLElement; update(items: MentionSuggestionItem[], active: number): void; destroy(): void } {
    const reactiveItems = ref<MentionSuggestionItem[]>(items);
    const reactiveActive = ref<number>(0);
    let app: App | null = null;

    const PopupComponent = defineComponent({
        render() {
            return h('ul', { class: 'mention-suggestion-list' },
                reactiveItems.value.length === 0
                    ? [h('li', { class: 'mention-suggestion-empty' }, 'No results')]
                    : reactiveItems.value.map((item, i) =>
                        h('li', {
                            key: `${item.entityType}-${item.entityId}`,
                            class: ['mention-suggestion-item', { 'is-active': i === reactiveActive.value }],
                            onMousedown: (e: MouseEvent) => {
                                e.preventDefault();
                                onSelect(item);
                            },
                        }, [
                            h('span', { class: 'mention-type-badge' }, TYPE_LABELS[item.entityType] ?? item.entityType),
                            h('span', { class: 'mention-label' }, item.label),
                        ]),
                    ),
            );
        },
    });

    const el = document.createElement('div');
    el.className = 'mention-suggestion-popup';
    document.body.appendChild(el);
    app = createApp(PopupComponent);
    app.mount(el);

    return {
        el,
        update(newItems: MentionSuggestionItem[], active: number) {
            reactiveItems.value = newItems;
            reactiveActive.value = active;
        },
        destroy() {
            app?.unmount();
            el.remove();
            app = null;
        },
    };
}

function positionPopup(el: HTMLElement, clientRect: (() => DOMRect | null) | null | undefined): void {
    const rect = clientRect?.();
    if (!rect) return;
    el.style.position = 'fixed';
    el.style.top = `${rect.bottom + 6}px`;
    el.style.left = `${Math.max(4, rect.left)}px`;
    el.style.zIndex = '9999';
}

// ─── Extension ────────────────────────────────────────────────────────────────

const InternalEntityMentionSuggestion = Extension.create({
    name: 'internalEntityMentionSuggestion',

    addProseMirrorPlugins() {
        // `this.editor` is fully mounted here (Extension lifecycle, not Mark lifecycle)
        const editorRef = this.editor;

        return [
            Suggestion<MentionSuggestionItem>({
                editor: editorRef,

                // Unique plugin key — avoids conflicts if multiple Suggestion plugins exist
                pluginKey: new PluginKey('internalEntityMentionSuggestion'),

                char: '@',
                allowSpaces: false,

                // ── Item query ───────────────────────────────────────────────
                items({ query }: { query: string }): MentionSuggestionItem[] {
                    const store = useMicadoEntitiesStore();

                    // Lazy-fetch: trigger load if entities not yet in cache.
                    // items() is synchronous so we fire-and-forget here — the
                    // Suggestion plugin will call items() again on the next
                    // keystroke once the fetch completes.
                    if (!store.allEntitiesFetched && !store.loading) {
                        void store.fetchAllEntities({ includeDraft: true } as Parameters<typeof store.fetchAllEntities>[0]);
                    }

                    const lq = query.toLowerCase().trim();
                    const out: MentionSuggestionItem[] = [];
                    const order: EntityTypeCode[] = ['g', 'p', 'i', 'e'];

                    for (const entityType of order) {
                        for (const entity of store.allEntitiesByType[entityType] ?? []) {
                            const label = entity.process ?? entity.title ?? '';
                            if (label && (lq === '' || label.toLowerCase().includes(lq))) {
                                out.push({ entityType, entityId: entity.id, label });
                            }
                            if (out.length >= 10) break;
                        }
                        if (out.length >= 10) break;
                    }

                    logger.debug('[InternalEntityMentionSuggestion] items', {
                        query,
                        count: out.length,
                    });
                    return out;
                },

                // ── Popup render lifecycle ────────────────────────────────────
                render() {
                    let popup: ReturnType<typeof mountPopup> | null = null;
                    let currentItems: MentionSuggestionItem[] = [];
                    let selectedIndex = 0;
                    let selectCommand: ((item: MentionSuggestionItem) => void) | null = null;

                    return {
                        onStart(props: SuggestionProps<MentionSuggestionItem>) {
                            selectCommand = props.command;
                            currentItems = props.items;
                            selectedIndex = 0;

                            logger.debug('[InternalEntityMentionSuggestion] onStart', { count: currentItems.length });

                            popup = mountPopup(currentItems, (item) => selectCommand?.(item));
                            positionPopup(popup.el, props.clientRect);
                        },

                        onUpdate(props: SuggestionProps<MentionSuggestionItem>) {
                            selectCommand = props.command;
                            currentItems = props.items;
                            selectedIndex = 0;

                            if (!popup) {
                                popup = mountPopup(currentItems, (item) => selectCommand?.(item));
                            } else {
                                popup.update(currentItems, selectedIndex);
                            }
                            positionPopup(popup.el, props.clientRect);
                        },

                        onKeyDown({ event }: { event: KeyboardEvent }): boolean {
                            if (!popup) return false;

                            if (event.key === 'ArrowDown') {
                                selectedIndex = (selectedIndex + 1) % Math.max(1, currentItems.length);
                                popup.update(currentItems, selectedIndex);
                                return true;
                            }
                            if (event.key === 'ArrowUp') {
                                selectedIndex = (selectedIndex - 1 + Math.max(1, currentItems.length)) % Math.max(1, currentItems.length);
                                popup.update(currentItems, selectedIndex);
                                return true;
                            }
                            if (event.key === 'Enter' || event.key === 'Tab') {
                                const item = currentItems[selectedIndex];
                                if (item) selectCommand?.(item);
                                return true;
                            }
                            if (event.key === 'Escape') {
                                popup.destroy();
                                popup = null;
                                return true;
                            }
                            return false;
                        },

                        onExit() {
                            logger.debug('[InternalEntityMentionSuggestion] onExit');
                            popup?.destroy();
                            popup = null;
                        },
                    };
                },

                // ── Insert command ───────────────────────────────────────────
                command({ editor, range, props: item }: {
                    editor: typeof editorRef;
                    range: { from: number; to: number };
                    props: MentionSuggestionItem;
                }) {
                    logger.info('[InternalEntityMentionSuggestion] inserting', {
                        type: item.entityType,
                        id: item.entityId,
                        label: item.label,
                    });

                    // Use the ProseMirror transaction API directly.
                    // insertContent({ type:'text', marks:[...] }) does not reliably apply
                    // marks in TipTap 3.x — the correct approach is schema.text() + mark.create().
                    editor.chain().focus().command(({ tr, dispatch, state }) => {
                        const mark = state.schema.marks['internalmention']?.create({
                            entityType: item.entityType,
                            entityId: item.entityId,
                        });

                        if (!mark) {
                            // Fallback: insert plain text if mark is not registered in schema
                            logger.warn('[InternalEntityMentionSuggestion] mark not found in schema');
                            if (dispatch) {
                                tr.insertText(item.label, range.from, range.to);
                                dispatch(tr);
                            }
                            return true;
                        }

                        // Create text node with the internalmention mark applied
                        const mentionNode = state.schema.text(item.label, [mark]);
                        // Trailing space — exits the non-inclusive mark so next keystroke is plain
                        const spaceNode = state.schema.text(' ');

                        if (dispatch) {
                            tr.replaceWith(range.from, range.to, [mentionNode, spaceNode]);
                            dispatch(tr);
                        }
                        return true;
                    }).run();
                },
            }),
        ];
    },
});

export default InternalEntityMentionSuggestion;