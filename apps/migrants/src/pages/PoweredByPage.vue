<script setup lang="ts">
/**
 * src/pages/PoweredByPage.vue
 *
 * Funding & partners page — shows EU grant acknowledgement and partner logos.
 * Fully static — no API calls, no store dependencies.
 *
 * ── Legacy mapping ────────────────────────────────────────────────────────────
 *   Legacy: src/pages/PoweredBy.vue (Vue 2)
 *   New:    src/pages/PoweredByPage.vue (Vue 3)
 */

import { useI18n } from 'vue-i18n';
import { useRouter } from 'vue-router';

const { t } = useI18n();
const router = useRouter();

// Partner list — static, matches legacy exactly.
// URLs and alt text are factual; logos are sourced from public CDN / Wikipedia
// where possible to avoid needing local SVG assets.
interface Partner { url: string; name: string; }

const PARTNERS: Partner[] = [
    { url: 'https://www.hcu-hamburg.de/research/csl/', name: 'HCU Hamburg' },
    { url: 'https://www.urjc.es/', name: 'URJC' },
    { url: 'https://www.colpolsoc.org/', name: 'Colpolsoc Madrid' },
    { url: 'https://www.aspbologna.it/', name: 'ASP Bologna' },
    { url: 'https://www.atlas-antwerpen.be/en', name: 'Atlas Antwerpen' },
    { url: 'https://www.csipiemonte.it/en', name: 'CSI Piemonte' },
    { url: 'https://www.comunidad.madrid/', name: 'Comunidad de Madrid' },
    { url: 'https://www.digipolisantwerpen.be/', name: 'Digipolis Antwerpen' },
    { url: 'https://www.hamburg.de/', name: 'Freie und Hansestadt Hamburg' },
    { url: 'https://www.antwerpen.be/', name: 'Stad Antwerpen' },
    { url: 'https://www.synyo.com/', name: 'SYNYO' },
    { url: 'https://simlab.tuwien.ac.at/', name: 'TU Wien SIMlab' },
    { url: 'https://www.unibo.it/en', name: 'Università di Bologna' },
    { url: 'https://www.hwwi.org/', name: 'HWWI Hamburg' },
];

function goBack(): void {
    router.go(-1);
}
</script>

<template>
    <q-page class="powered-by-page">

        <!-- Micado logo -->
        <div class="row justify-center q-pt-lg q-pb-md">
            <img src="~assets/micado-logo.png" alt="Micado" class="powered-logo" />
        </div>

        <!-- Powered by Micado image -->
        <div class="row justify-center q-pb-md">
            <img src="~assets/powered_Micado.png" alt="Powered by Micado" style="max-width: 220px; width: 80%;" />
        </div>

        <!-- Grant text -->
        <div class="text-center q-px-md q-pb-sm text-body2 text-grey-8">
            {{ t('privacy.grant') }}
        </div>

        <!-- EU flag -->
        <div class="row justify-center q-pb-md">
            <img src="~assets/Flag_of_Europe.png" alt="Funded by the European Union"
                style="width: 80px; height: 53px;" />
        </div>

        <q-separator class="q-mb-md" />

        <!-- Partner list -->
        <div class="column items-center q-gutter-sm q-px-md q-pb-xl">
            <div v-for="partner in PARTNERS" :key="partner.url" class="full-width text-center">
                <a :href="partner.url" target="_blank" rel="noopener noreferrer" class="partner-link">
                    {{ partner.name }}
                </a>
                <q-separator class="q-mt-sm" color="grey-3" />
            </div>
        </div>

        <!-- Back button -->
        <div class="row justify-center q-pb-xl">
            <q-btn outline rounded no-caps icon="arrow_back" :label="t('button.go_back')" class="go-back-btn"
                @click="goBack" />
        </div>

    </q-page>
</template>

<style scoped lang="scss">
.powered-by-page {
    max-width: 480px;
    margin: 0 auto;
}

.powered-logo {
    max-width: 220px;
    width: 70%;
}

.partner-link {
    color: $primary;
    font-weight: 600;
    font-size: 14px;
    text-decoration: none;

    &:hover {
        text-decoration: underline;
    }
}

.go-back-btn {
    border-color: #0f3a5d;
    color: #0f3a5d;
    min-width: 180px;
}
</style>