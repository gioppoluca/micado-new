<script setup lang="ts">
import micadoLogo from 'src/assets/micado-logo.png';
import poweredByMicado from 'src/assets/powered_Micado.png';
import euFlag from 'src/assets/Flag_of_Europe.png';

const buildDate = new Date().toLocaleString();
</script>

<template>
  <q-page class="micado-page flex flex-center column q-pa-lg text-center">
    <div class="row justify-center full-width q-mb-md">
      <img alt="Micado logo" :src="micadoLogo" class="micado-hero-logo" />
    </div>

    <div class="text-subtitle2 micado-pad-x q-mb-xl">Build: {{ buildDate }}</div>

    <div class="row justify-center full-width q-mb-md">
      <img alt="Powered by Micado" :src="poweredByMicado" style="max-width: 260px; width: 100%" />
    </div>

    <div class="micado-pad-x text-caption q-mb-md">
      This project has received funding from the European Union’s H2020 Innovation Action under Grant Agreement No 822717.
    </div>

    <img alt="Funded by EU" :src="euFlag" class="micado-eu-flag" />
  </q-page>
</template>
