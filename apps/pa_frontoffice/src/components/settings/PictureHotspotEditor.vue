<template>
    <!--
    PictureHotspotEditor
    ════════════════════
    Renders a document picture with interactive hotspot pins.

    ── User interactions ────────────────────────────────────────────────────
    ADD pin    : click anywhere on the image (not on an existing pin)
    MOVE pin   : drag an existing pin to reposition it
    EDIT pin   : click an existing pin → opens the per-pin translation form
    DELETE pin : click the ✕ button inside the per-pin form

    ── Coordinate system ────────────────────────────────────────────────────
    Coordinates are stored as percentages (0–100) of the image dimensions.
    This makes them resolution-independent: the same pin renders correctly
    regardless of how large the image is rendered on screen.
    On click/drag we compute:   x% = (clientX - rect.left) / rect.width * 100

    ── Props ────────────────────────────────────────────────────────────────
    picture      : DocumentPicture  — the image to annotate
    modelValue   : DocumentHotspot[] — bound hotspot array (v-model)
    languages    : Language[]         — active languages for translation tabs
    sourceLang   : string             — source language (first tab)
    readonly     : boolean            — disable add/move/delete

    ── Emits ────────────────────────────────────────────────────────────────
    update:modelValue  — emitted whenever hotspots array changes
    -->
    <div class="hotspot-editor">

        <!-- ── Image + pins container ─────────────────────────────────────── -->
        <div ref="imageContainerRef" class="hotspot-editor__canvas"
            :class="{ 'hotspot-editor__canvas--editable': !readonly }" @click.self="onCanvasClick">
            <!-- The annotated image -->
            <img ref="imageRef" :src="picture.image" class="hotspot-editor__image" draggable="false" alt=""
                @load="onImageLoaded" />

            <!-- Hotspot pins — positioned absolutely as % of the container -->
            <div v-for="(hotspot, idx) in modelValue" :key="hotspot.id ?? `new-${idx}`" class="hotspot-pin" :class="{
                'hotspot-pin--selected': selectedIdx === idx,
                'hotspot-pin--dragging': draggingIdx === idx,
            }" :style="{ left: hotspot.x + '%', top: hotspot.y + '%' }" :title="pinLabel(hotspot)"
                @mousedown.stop="onPinMousedown($event, idx)" @click.stop="onPinClick(idx)">
                <span class="hotspot-pin__number">{{ idx + 1 }}</span>
            </div>
        </div>

        <!-- ── Per-pin translation form ────────────────────────────────────── -->
        <q-card v-if="selectedIdx !== null && modelValue[selectedIdx]" class="q-mt-md q-pa-md hotspot-form" flat
            bordered>
            <div class="row items-center q-mb-sm">
                <span class="text-weight-medium col">
                    {{ t('input_labels.hotspot') }} #{{ selectedIdx + 1 }}
                    <span class="text-caption text-grey-6 q-ml-sm">
                        ({{ Math.round(modelValue[selectedIdx]!.x) }}%,
                        {{ Math.round(modelValue[selectedIdx]!.y) }}%)
                    </span>
                </span>
                <q-btn v-if="!readonly" flat round dense icon="delete" color="negative" size="sm"
                    :title="t('button.delete')" @click="onDeletePin(selectedIdx)" />
                <q-btn flat round dense icon="close" size="sm" @click="selectedIdx = null" />
            </div>

            <!-- Translation tabs: one per active language -->
            <q-tabs v-model="activeTranslationLang" dense align="left" active-color="accent" indicator-color="accent"
                class="q-mb-sm">
                <q-tab v-for="lang in sortedLanguages" :key="lang.lang" :name="lang.lang"
                    :label="lang.lang.toUpperCase()">
                    <!-- tStatus badge on tab -->
                    <q-badge v-if="tStatusColor(selectedIdx, lang.lang)" :color="tStatusColor(selectedIdx, lang.lang)"
                        floating rounded style="font-size:8px; min-width:8px; height:8px; padding:0" />
                </q-tab>
            </q-tabs>

            <q-tab-panels v-model="activeTranslationLang" animated>
                <q-tab-panel v-for="lang in sortedLanguages" :key="lang.lang" :name="lang.lang" class="q-pa-none">
                    <!-- title: pin label (short) -->
                    <q-input :model-value="getTranslation(selectedIdx, lang.lang, 'title')" dense outlined
                        :label="t('input_labels.title') + ' *'" :maxlength="100" counter :readonly="readonly"
                        class="q-mb-sm"
                        @update:model-value="setTranslation(selectedIdx, lang.lang, 'title', $event as string)" />
                    <!-- message: tooltip body (long) -->
                    <q-input :model-value="getTranslation(selectedIdx, lang.lang, 'message')" dense outlined
                        type="textarea" :label="t('input_labels.hotspot_message')" :rows="3" :readonly="readonly"
                        @update:model-value="setTranslation(selectedIdx, lang.lang, 'message', $event as string)" />
                </q-tab-panel>
            </q-tab-panels>
        </q-card>

        <!-- ── Empty state ─────────────────────────────────────────────────── -->
        <div v-if="!readonly && modelValue.length === 0" class="text-caption text-grey-6 q-mt-sm">
            {{ t('help.hotspot_click_to_add') }}
        </div>
    </div>
</template>

<script setup lang="ts">
/**
 * PictureHotspotEditor
 *
 * Pure Vue 3 component — zero external dependencies.
 *
 * Coordinate math:
 *   x%, y% are computed from the click/drag position relative to the
 *   imageContainerRef bounding rect.  On mount, the container takes the
 *   natural dimensions of the image (max 100% width via CSS).
 *   The percentage coordinates are resolution-independent.
 *
 * Drag logic:
 *   mousedown on a pin → record dragging state
 *   mousemove on window → update pin position in real time
 *   mouseup on window → commit and clean up
 *   If total drag distance < DRAG_THRESHOLD px → treated as a click (open form)
 */

import { ref, computed, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import type { DocumentHotspot, DocumentPicture } from 'src/api/document-type.api';
import type { Language } from 'src/api/language.api';

// ─── Props / emits ─────────────────────────────────────────────────────────────

const props = withDefaults(defineProps<{
    picture: DocumentPicture;
    modelValue: DocumentHotspot[];
    languages: Language[];
    sourceLang: string;
    readonly?: boolean;
}>(), {
    readonly: false,
});

const emit = defineEmits<{
    (e: 'update:modelValue', value: DocumentHotspot[]): void;
}>();

const { t } = useI18n();

// ─── Refs ──────────────────────────────────────────────────────────────────────

const imageContainerRef = ref<HTMLElement | null>(null);
const imageRef = ref<HTMLImageElement | null>(null);
const imageLoaded = ref(false);

const selectedIdx = ref<number | null>(null);
const activeTranslationLang = ref(props.sourceLang);

// ─── Drag state ────────────────────────────────────────────────────────────────

const draggingIdx = ref<number | null>(null);
let dragStartX = 0;
let dragStartY = 0;
let dragMoved = false;
const DRAG_THRESHOLD = 4; // px — below this, treat as click

// ─── Computed ─────────────────────────────────────────────────────────────────

/** sourceLang first, then remaining langs alphabetically. */
const sortedLanguages = computed(() => [
    ...props.languages.filter(l => l.lang === props.sourceLang),
    ...props.languages.filter(l => l.lang !== props.sourceLang).sort((a, b) => a.lang.localeCompare(b.lang)),
]);

// ─── Helpers ──────────────────────────────────────────────────────────────────

function getPercentCoords(event: MouseEvent): { x: number; y: number } | null {
    const rect = imageContainerRef.value?.getBoundingClientRect();
    if (!rect) return null;
    const x = Math.max(0, Math.min(100, (event.clientX - rect.left) / rect.width * 100));
    const y = Math.max(0, Math.min(100, (event.clientY - rect.top) / rect.height * 100));
    return { x, y };
}

function pinLabel(hotspot: DocumentHotspot): string {
    return hotspot.translations?.[props.sourceLang]?.title || '';
}

function getTranslation(
    idx: number | null,
    lang: string,
    field: 'title' | 'message',
): string {
    if (idx === null) return '';
    return props.modelValue[idx]?.translations?.[lang]?.[field] ?? '';
}

function setTranslation(
    idx: number | null,
    lang: string,
    field: 'title' | 'message',
    value: string,
): void {
    if (idx === null) return;
    const hotspots = props.modelValue.map((h, i) => {
        if (i !== idx) return h;
        const existing = h.translations?.[lang] ?? { title: '', message: '' };
        return {
            ...h,
            translations: {
                ...h.translations,
                [lang]: { ...existing, [field]: value },
            },
        };
    });
    emit('update:modelValue', hotspots);
}

function tStatusColor(idx: number | null, lang: string): string {
    if (idx === null) return '';
    const tStatus = props.modelValue[idx]?.translations?.[lang]?.tStatus;
    switch (tStatus) {
        case 'STALE': return 'warning';
        case 'APPROVED': return 'info';
        case 'PUBLISHED': return 'positive';
        default: return '';
    }
}

// ─── Image load ────────────────────────────────────────────────────────────────

function onImageLoaded(): void {
    imageLoaded.value = true;
}

// ─── Canvas click (add pin) ────────────────────────────────────────────────────

function onCanvasClick(event: MouseEvent): void {
    if (props.readonly || !imageLoaded.value) return;
    const coords = getPercentCoords(event);
    if (!coords) return;

    const newHotspot: DocumentHotspot = {
        pictureId: props.picture.id,
        x: coords.x,
        y: coords.y,
        sortOrder: props.modelValue.length + 1,
        translations: Object.fromEntries(
            props.languages.map(l => [l.lang, { title: '', message: '' }]),
        ),
    };

    const updated = [...props.modelValue, newHotspot];
    emit('update:modelValue', updated);

    // Auto-open the new pin form
    selectedIdx.value = updated.length - 1;
    activeTranslationLang.value = props.sourceLang;
}

// ─── Pin click ─────────────────────────────────────────────────────────────────

function onPinClick(idx: number): void {
    if (dragMoved) return; // was a drag, not a click
    selectedIdx.value = selectedIdx.value === idx ? null : idx;
    if (selectedIdx.value !== null) {
        activeTranslationLang.value = props.sourceLang;
    }
}

// ─── Pin drag ─────────────────────────────────────────────────────────────────

function onPinMousedown(event: MouseEvent, idx: number): void {
    if (props.readonly) return;
    event.preventDefault();

    draggingIdx.value = idx;
    dragStartX = event.clientX;
    dragStartY = event.clientY;
    dragMoved = false;

    const onMousemove = (e: MouseEvent): void => {
        const dx = e.clientX - dragStartX;
        const dy = e.clientY - dragStartY;
        if (!dragMoved && Math.hypot(dx, dy) >= DRAG_THRESHOLD) {
            dragMoved = true;
        }
        if (!dragMoved) return;

        const coords = getPercentCoords(e);
        if (!coords) return;

        const hotspots = props.modelValue.map((h, i) => {
            if (i !== idx) return h;
            return { ...h, x: coords.x, y: coords.y };
        });
        emit('update:modelValue', hotspots);
    };

    const onMouseup = (): void => {
        draggingIdx.value = null;
        window.removeEventListener('mousemove', onMousemove);
        window.removeEventListener('mouseup', onMouseup);
    };

    window.addEventListener('mousemove', onMousemove);
    window.addEventListener('mouseup', onMouseup);
}

// ─── Delete pin ────────────────────────────────────────────────────────────────

function onDeletePin(idx: number | null): void {
    if (idx === null) return;
    const updated = props.modelValue.filter((_, i) => i !== idx).map((h, i) => ({
        ...h,
        sortOrder: i + 1,
    }));
    emit('update:modelValue', updated);
    selectedIdx.value = null;
}

// ─── Watch source lang ─────────────────────────────────────────────────────────

watch(() => props.sourceLang, (lang) => {
    activeTranslationLang.value = lang;
});
</script>

<style scoped>
.hotspot-editor {
    width: 100%;
}

/* The image container — position:relative so pins can be absolute inside it */
.hotspot-editor__canvas {
    position: relative;
    display: inline-block;
    width: 100%;
    user-select: none;
    border-radius: 4px;
    overflow: hidden;
    border: 1px solid #e0e0e0;
}

.hotspot-editor__canvas--editable {
    cursor: crosshair;
}

.hotspot-editor__image {
    display: block;
    width: 100%;
    height: auto;
    pointer-events: none;
    /* clicks bubble up to the container */
    draggable: false;
}

/* Pin circle */
.hotspot-pin {
    position: absolute;
    transform: translate(-50%, -50%);
    width: 28px;
    height: 28px;
    border-radius: 50%;
    background: #ff7c44;
    border: 2px solid #fff;
    box-shadow: 0 2px 6px rgba(0, 0, 0, 0.35);
    display: flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
    transition: transform 0.1s, box-shadow 0.1s;
    z-index: 2;
}

.hotspot-pin:hover {
    transform: translate(-50%, -50%) scale(1.15);
    box-shadow: 0 3px 10px rgba(0, 0, 0, 0.45);
}

.hotspot-pin--selected {
    background: #9e1f63;
    transform: translate(-50%, -50%) scale(1.2);
}

.hotspot-pin--dragging {
    cursor: grabbing;
    opacity: 0.75;
}

.hotspot-pin__number {
    font-size: 11px;
    font-weight: 700;
    color: #fff;
    line-height: 1;
    pointer-events: none;
}

/* Per-pin translation form card */
.hotspot-form {
    background: var(--q-color-grey-1, #fafafa);
}
</style>