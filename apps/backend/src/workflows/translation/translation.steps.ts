import { DBOS } from '@dbos-inc/dbos-sdk';
import { GiteaTranslationExportService } from '../../services/gitea-translation-export.service';

export class TranslationSteps {

    /**
     * Push the EN source string to Gitea so Weblate picks it up.
     * Wraps the existing GiteaTranslationExportService.
     */
    @DBOS.step()
    static async pushSourceToGitea(input: {
        category: string;
        itemId: string;
        fieldKey: string;
        value: string;
    }): Promise<void> {
        // DBOS.logger is the built-in DBOS logger — available inside steps/workflows
        // without needing injection. Use it as the logger substitute.
        const svc = new GiteaTranslationExportService(DBOS.logger as any);
        await svc.exportTranslationEntry({
            category: input.category,
            isoCode: 'en',
            itemId: input.itemId,
            fieldKey: input.fieldKey,
            value: input.value,
        });
    }

    /**
     * Call your AI TTS API and return the URL of the stored MP3.
     * Replace the body with your actual TTS provider call.
     */
    @DBOS.step({ intervalSeconds: 30, maxAttempts: 5 })
    static async generateMp3(input: {
        lang: string;
        translation: string;
        revisionId: string;
    }): Promise<string> {
        // TODO: call ElevenLabs / Azure TTS / etc.
        // Return a publicly accessible URL to the mp3.
        const mp3Url = `https://your-storage/tts/${input.revisionId}/${input.lang}.mp3`;
        return mp3Url;
    }

    /**
     * Persist the translated string (and optional MP3 URL) to the application DB.
     */
    @DBOS.step()
    static async saveTranslationToDB(input: {
        revisionId: string;
        lang: string;
        itemId: string;
        fieldKey: string;
        translation: string;
        mp3Url: string | null;
        sourceHash: string;
    }): Promise<void> {
        // TODO: use your LoopBack repository to upsert the translation row.
        // Example: await translationRepository.upsert({ ... });
    }
}