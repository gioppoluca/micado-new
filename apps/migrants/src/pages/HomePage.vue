<script setup lang="ts">
import { ref } from 'vue';

const searchText = ref('');

const topicCards = [
  { title: 'Housing', icon: 'home' },
  { title: 'Health', icon: 'medical_services' },
  { title: 'Education', icon: 'school' },
  { title: 'Work', icon: 'work' },
  { title: 'Documents', icon: 'description' },
  { title: 'Services', icon: 'support_agent' },
];
</script>

<template>
  <q-page class="micado-page q-pb-xl">
    <div class="q-pa-md q-pb-sm">
      <div class="text-grey-7 text-caption">Home</div>
    </div>

    <div class="micado-page-divider"></div>

    <div class="q-pa-md">
      <q-input
        v-model="searchText"
        outlined
        filled
        dense
        bg-color="grey-2"
        label-color="grey-8"
        label="Search"
      >
        <template #append>
          <q-icon name="search" />
        </template>
      </q-input>
    </div>

    <div class="micado-page-divider q-mb-md"></div>

    <div class="q-px-md q-pb-md">
      <div class="micado-topic-grid">
        <q-card v-for="topic in topicCards" :key="topic.title" flat class="micado-topic-card">
          <q-card-section class="column items-center justify-center q-pa-sm">
            <q-icon :name="topic.icon" size="32px" color="orange-7" class="q-mb-sm" />
            <div class="micado-topic-title">{{ topic.title }}</div>
          </q-card-section>
        </q-card>
      </div>
    </div>

    <div class="q-px-md">
      <q-card flat class="micado-card-panel q-pa-md">
        <div class="text-subtitle1 q-mb-sm">TODO</div>
        <div class="text-body2 text-grey-7">
          This protected home page will contain the topic cards and the legacy migrant navigation flow.
        </div>
      </q-card>
    </div>
  </q-page>
</template>
