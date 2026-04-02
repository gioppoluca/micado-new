/**
 * src/shims/vue3-treeselect.d.ts
 *
 * Module declaration for vue3-treeselect which ships no TypeScript types.
 *
 * We expose only the props surface we actually use. Extend as needed.
 * The component accepts any prop not listed here via `additionalProperties`.
 *
 * Isolation note: TopicTreeSelect.vue is the ONLY consumer of this library
 * in the entire codebase. If the library is ever replaced, only that component
 * and this declaration need to change.
 */

declare module 'vue3-treeselect' {
    import type { DefineComponent } from 'vue';

    /** A single node in the options tree. */
    export interface TreeselectNode {
        /** Unique identifier (number or string). */
        id: number | string;
        /** Display label. */
        label: string;
        /** Child nodes, if any. */
        children?: TreeselectNode[];
        /** When true the node is shown but cannot be selected. */
        isDisabled?: boolean;
        /** Any extra data you want to attach and read in slots. */
        [key: string]: unknown;
    }

    const Treeselect: DefineComponent<{
        /** The flat or nested options array. */
        options: TreeselectNode[];
        /** The bound value (id or null for single; id[] for multiple). */
        modelValue: number | string | null | (number | string)[];
        /** Allow multi-selection. Default: false. */
        multiple?: boolean;
        /** In multi-mode, flatten the hierarchy for selection. Default: false. */
        flat?: boolean;
        /** Placeholder shown when no value is selected. */
        placeholder?: string;
        /** Disable the entire widget. */
        disabled?: boolean;
        /** Clear the selection when the clear button is clicked. */
        clearable?: boolean;
        /** Expand to this depth on mount. Default: 0. */
        defaultExpandLevel?: number;
        /** Allow searching across all nodes. */
        searchable?: boolean;
        /** Append the menu to the document body. */
        appendToBody?: boolean;
    }>;

    export { Treeselect as default };
}