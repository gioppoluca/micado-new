<template>
    <q-page class="q-pa-md">
        <div class="text-h5 q-mb-md">Information</div>

        <q-list bordered separator>
            <q-item clickable to="/privacy">
                <q-item-section>Privacy policy</q-item-section>
            </q-item>

            <q-item clickable @click="openConsentManager">
                <q-item-section>Manage cookies</q-item-section>
            </q-item>
        </q-list>
    </q-page>
</template>

<script setup lang="ts">
function openConsentManager() {
    console.log('TODO: integrate Klaro');
}
</script>