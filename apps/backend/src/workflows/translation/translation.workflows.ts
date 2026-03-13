import { DBOS } from '@dbos-inc/dbos-sdk';

export type WeblateImportMessage = {
    revisionId: string;
    lang: string;
    sourceHash: string;
    // payload che ti serve per leggere file/entry etc
    payload: unknown;
};

export class TranslationWorkflows {
    // MASTER (padre): fa partire 1 child per lingua
    @DBOS.workflow()
    static async translationMaster(revisionId: string, langs: string[]) {
        for (const lang of langs) {
            const childId = `tr:${revisionId}:${lang}`;
            await DBOS.startWorkflow(TranslationWorkflows, { workflowID: childId })
                .translationLanguage(revisionId, lang);
        }

        // opzionale: pubblica un event "started"
        await DBOS.setEvent('startedLangs', langs);
        return { revisionId, started: langs };
    }

    // CHILD (figlio): aspetta import per la lingua e poi farà i passi (placeholder)
    @DBOS.workflow()
    static async translationLanguage(revisionId: string, lang: string) {
        const topic = `weblate-import:${lang}`;

        // attesa (durabile) di un messaggio; timeout in secondi
        const msg = await DBOS.recv<WeblateImportMessage>(topic, 60);
        if (!msg) {
            // qui puoi gestire timeout (retry, alert, setEvent, ecc.)
            await DBOS.setEvent(`lang:${lang}:status`, 'TIMEOUT_WAITING_IMPORT');
            return { revisionId, lang, status: 'TIMEOUT' };
        }

        await DBOS.setEvent(`lang:${lang}:status`, 'RECEIVED_IMPORT');

        // TODO: qui chiamerai step I/O: fetch file da gitea, merge json, commit, update DB
        return { revisionId, lang, status: 'RECEIVED', sourceHash: msg.sourceHash };
    }
}