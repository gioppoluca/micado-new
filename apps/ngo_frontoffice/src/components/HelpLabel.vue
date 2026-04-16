<template>
    <div class="row items-center all-pointer-events" style="padding-top: 10px; font-size: 16px">
        <!--
      Old app used img:statics/icons/Help.png (Quasar 1 static path).
      Quasar 2 serves from /public — use img:icons/Help.png if the file
      exists there, otherwise fall back to the built-in help_outline icon.
    -->
        <q-icon class="q-mr-xs" size="24px" name="help_outline" color="accent" />
        {{ fieldLabel }}
        <q-tooltip anchor="top left" self="bottom left" :offset="[0, 8]">
            {{ helpLabel }}
        </q-tooltip>
    </div>
</template>

<script setup lang="ts">
/**
 * HelpLabel — display a labelled field title with an inline help tooltip.
 *
 * Migration notes from Vue 2:
 *  - Removed `this.fieldLabel` interpolation (wrong in Vue 2 too; templates
 *    access props directly without `this`).
 *  - content-class on q-tooltip replaced by standard Quasar 2 class prop.
 *  - img:statics/ path replaced; icon falls back to material help_outline
 *    until the PNG asset is copied to public/icons/.
 */
defineProps<{
    fieldLabel: string
    helpLabel?: string
}>()
</script>