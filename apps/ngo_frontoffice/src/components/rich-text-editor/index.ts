/**
 * src/components/rich-text-editor/index.ts
 *
 * Barrel export per i componenti del rich-text-editor.
 * RichTextEditor.vue è in src/components/ (radice) perché rimpiazza
 * lo stub già esistente — viene importato direttamente con 'src/components/RichTextEditor.vue'.
 *
 * @example
 * import { RichTextViewer, MultiLangEditorTabs } from 'src/components/rich-text-editor';
 */

export { default as RichTextViewer } from './RichTextViewer.vue';
export { default as MultiLangEditorTabs } from './MultiLangEditorTabs.vue';
export { default as EntityPreviewDialog } from './EntityPreviewDialog.vue';