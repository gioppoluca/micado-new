import { api } from 'boot/axios';
import { consola } from 'consola';
import type { ConsentSnapshot, ConsentSyncPayload } from './consent-types';

const logger = consola.withTag('consent-sync');

export class ConsentSyncService {
    async saveUserConsent(payload: ConsentSyncPayload): Promise<void> {
        logger.info('Saving consent snapshot for user', payload.userId);

        await api.put(`/users/${payload.userId}/consent`, payload.snapshot);
    }

    async loadUserConsent(userId: string): Promise<ConsentSnapshot | null> {
        try {
            logger.info('Loading consent snapshot for user', userId);
            const response = await api.get<ConsentSnapshot | null>(`/users/${userId}/consent`);
            return response.data;
        } catch (error) {
            logger.warn('Unable to load user consent snapshot', error);
            return null;
        }
    }
}