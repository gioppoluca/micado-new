import { computed } from 'vue';
import { consentService } from 'src/services/consent/consent-service';
import type { ConsentServiceKey } from 'src/services/consent/consent-types';

export function useConsent() {
    const state = consentService.getState();

    const isReady = computed(() => state.ready);

    function showPreferences() {
        consentService.showPreferences();
    }

    function showNotice() {
        consentService.showNotice();
    }

    function hasConsent(service: ConsentServiceKey) {
        return consentService.hasServiceConsent(service);
    }

    async function syncCurrentUserConsent() {
        await consentService.syncCurrentUserConsent();
    }

    return {
        state,
        isReady,
        showPreferences,
        showNotice,
        hasConsent,
        syncCurrentUserConsent,
    };
}