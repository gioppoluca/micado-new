/**
 * src/i18n/it-IT/index.ts
 *
 * Italian translation strings — mirrors the en-US structure exactly.
 * Klaro requires both 'en' and 'it' blocks in its translations config;
 * these strings are consumed by klaro-config.factory.ts via t(..., { locale: 'it-IT' }).
 */

export default {
    failed: 'Operazione fallita',
    success: 'Operazione completata',

    welcome: {
        start: 'Iniziamo!',
        howItWorks: 'Come funziona questa app?',
        topicContent: 'Scegli un argomento e trova informazioni',
        categoryContent: 'Tutti i contenuti sono suddivisi in 3 gruppi principali',
        loginContent: 'Se crei un account, le organizzazioni pubbliche potranno aiutarti nel percorso di integrazione tramite il Portafoglio Documenti e i Piani di Integrazione:',
        noLandingPage: 'Non mostrare più questa pagina',
        explore: 'Esplora',
        defaultInfoText: 'Trova informazioni di base sugli argomenti rilevanti per il tuo percorso di integrazione.',
        defaultGuidesText: 'Guide passo-passo per orientarti nelle procedure ufficiali.',
        defaultEventText: 'Eventi, corsi e attività nella tua zona.',
        defaultDocText: 'Archivia e gestisci i tuoi documenti personali in modo sicuro.',
        defaultPlanText: 'Segui il tuo piano di integrazione personalizzato.',
    },

    menu: {
        home: 'Home',
        info: 'Informazioni di base',
        guides: 'Istruzioni passo-passo',
        events: 'Eventi e corsi',
        documents: 'I miei documenti',
        integration_plan: 'Piani di integrazione',
        glossary: 'Glossario',
        feedback: 'Feedback',
        about: 'Info',
        profile: 'Profilo',
        settings: 'Impostazioni',
        login: 'Accedi',
        logout: 'Esci',
        selectLanguage: 'Seleziona la lingua',
    },

    desc_labels: {
        search: 'Cerca',
        loading: 'Caricamento…',
        no_results: 'Nessun risultato trovato',
        retry: 'Riprova',
    },

    glossary: {
        missing_content: 'Nessun termine del glossario trovato.',
    },

    privacy: {
        title: 'Privacy',
        privacyPageLink: 'Informativa sulla privacy',
    },

    consent: {
        notice: {
            title: 'Rispettiamo la tua privacy',
            description: 'Questa app utilizza cookie e tecnologie simili per erogare i suoi servizi. Alcuni sono essenziali; altri ci aiutano a migliorare la tua esperienza. Puoi accettare tutto, rifiutare quelli facoltativi o gestire le tue preferenze singolarmente.',
            learnMore: 'Scopri di più',
        },
        modal: {
            title: 'Preferenze sulla privacy',
            description: 'Qui puoi rivedere e personalizzare le autorizzazioni che ci concedi. Le tue scelte si applicano a questo dispositivo e browser.',
            privacyPolicyName: 'informativa sulla privacy',
            privacyPolicyText: 'Per tutti i dettagli, ti invitiamo a leggere la nostra {privacyPolicy}.',
        },
        actions: {
            ok: 'Accetta tutto',
            acceptAll: 'Accetta tutto',
            decline: 'Rifiuta facoltativi',
            declineAll: 'Rifiuta tutto',
            save: 'Salva preferenze',
            close: 'Chiudi',
        },
        labels: {
            service: 'servizio',
            services: 'servizi',
        },
        purposes: {
            necessary: {
                title: 'Essenziali',
                description: 'Questi cookie sono necessari per il corretto funzionamento dell\'app e non possono essere disabilitati.',
            },
            analytics: {
                title: 'Analisi',
                description: 'Ci aiutano a capire come viene utilizzata l\'app per migliorarla. Nessun dato personale viene venduto.',
            },
            embeddedMedia: {
                title: 'Media incorporati',
                description: 'Permettono di visualizzare contenuti video e multimediali incorporati da piattaforme esterne come YouTube.',
            },
            externalMaps: {
                title: 'Mappe esterne',
                description: 'Permettono di utilizzare mappe interattive fornite da servizi di terze parti.',
            },
            thirdPartySupport: {
                title: 'Strumenti di supporto',
                description: 'Permettono l\'utilizzo di strumenti di terze parti per fornire assistenza nell\'app.',
            },
        },
        services: {
            usageTracker: {
                title: 'Analisi dell\'utilizzo',
                description: 'Raccoglie dati anonimi sulle pagine visitate per migliorare l\'app.',
            },
            youtubeEmbed: {
                title: 'YouTube',
                description: 'Consente la riproduzione di video YouTube incorporati nell\'app.',
            },
            atlasEmbed: {
                title: 'Mappe Atlas',
                description: 'Fornisce mappe interattive tramite la piattaforma Atlas.',
            },
            supportWidget: {
                title: 'Widget di supporto',
                description: 'Abilita la chat di supporto e il widget di aiuto nell\'app.',
            },
        },
    },
};