<template>
    <!--
    TopicIcon.vue
    Renders a topic icon that can be a Material icon name, a data: URI,
    or a regular URL. Falls back to the `fallback` prop when icon is absent.
  -->
    <img v-if="isImageSrc" :src="resolvedIcon" :width="pixelSize" :height="pixelSize" :alt="alt" :style="imgStyle"
        class="topic-icon-img" aria-hidden="true" />
    <q-icon v-else :name="resolvedIcon" :size="size" v-bind="colorProp" :class="iconClass" />
</template>

<script setup lang="ts">
/**
 * TopicIcon — smart icon renderer for topic entities.
 *
 * Discriminates automatically between:
 *   • Material / Quasar icon name   "home", "local_hospital"  → <q-icon>
 *   • data: URI (any type)          "data:image/svg+xml;…"    → <img>
 *   • Absolute / relative URL       "https://…", "/img/…"     → <img>
 *   • null / empty                  →  <q-icon name="{fallback}">
 *
 * Usage:
 *   <TopicIcon :icon="topic.icon" size="28px" color="secondary" />
 *   <TopicIcon :icon="topic.icon" fallback="category" size="32px" />
 */
import { computed } from 'vue';

// ─── Props ────────────────────────────────────────────────────────────────────

/**
 * `color` is intentionally NOT given a default via withDefaults because
 * exactOptionalPropertyTypes:true forbids assigning `undefined` to `string`.
 * Instead it is declared as `string | undefined` and forwarded via v-bind
 * only when present, so q-icon inherits its own default (no colour token).
 */
const props = withDefaults(
    defineProps<{
        /** Icon string from the backend — Material name, data URI, or URL. */
        icon?: string | null;
        /** Quasar size string used for q-icon / converted for img. Default 28px. */
        size?: string;
        /** Quasar color token forwarded to q-icon only (e.g. "secondary"). */
        color?: string;
        /** Material icon name used when icon is absent/unrecognised. */
        fallback?: string;
        /** Alt text for img mode (accessibility). Empty string hides from AT. */
        alt?: string;
        /** Extra CSS classes forwarded to q-icon only. */
        iconClass?: string;
    }>(),
    {
        // `color` is intentionally absent — see JSDoc above.
        icon: null,
        size: '28px',
        fallback: 'label',
        alt: '',
        iconClass: '',
    },
);

// ─── Computed ─────────────────────────────────────────────────────────────────

/**
 * True when the icon value should be rendered as an <img> src.
 * Covers data: URIs of any mime type, HTTP(S) URLs, and relative paths.
 */
const isImageSrc = computed<boolean>(() => {
    if (!props.icon) return false;
    const v = props.icon.trim();
    return (
        v.startsWith('data:') ||
        v.startsWith('http://') ||
        v.startsWith('https://') ||
        v.startsWith('/') ||
        v.startsWith('./')
    );
});

/** Resolved value forwarded to either <img :src> or <q-icon :name>. */
const resolvedIcon = computed<string>(() => {
    if (!props.icon || props.icon.trim() === '') return props.fallback;
    return props.icon.trim();
});

/** Pass-through of size for the img width/height attributes. */
const pixelSize = computed<string>(() => props.size);

/** Inline style keeps the image square and contained within its cell. */
const imgStyle = computed(() => ({
    width: props.size,
    height: props.size,
    objectFit: 'contain' as const,
    display: 'block',
    flexShrink: 0,
}));

/**
 * Spread onto q-icon only when color is actually provided.
 * Avoids passing `color="undefined"` (string) to the component under
 * exactOptionalPropertyTypes — Vue would stringify it as the attribute value.
 */
const colorProp = computed<{ color: string } | Record<string, never>>(() =>
    props.color !== undefined ? { color: props.color } : {},
);
</script>

<style scoped>
/* Prevent data-URI SVGs from rendering at their intrinsic (potentially huge) size. */
.topic-icon-img {
    max-width: 100%;
    max-height: 100%;
}
</style>