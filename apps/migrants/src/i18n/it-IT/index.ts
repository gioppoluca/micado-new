/**
 * src/i18n/it-IT/index.ts — Italian strings. Mirrors en-US structure exactly.
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
        about: 'Altro',
        profile: 'Profilo',
        settings: 'Impostazioni',
        login: 'Accedi',
        logout: 'Esci',
        selectLanguage: 'Seleziona la lingua',
        welcome: 'Pagina di benvenuto',
        policy: 'Informativa sulla privacy',
        consent: 'Gestisci i cookie',
        funding: 'Finanziato da / Partner',

        tasks: 'Piani di integrazione',
    },

    desc_labels: {
        search: 'Cerca',
        loading: 'Caricamento…',
        no_results: 'Nessun risultato trovato',
        retry: 'Riprova',
        survey_desc: 'Compila il nostro sondaggio',
        survey_link: 'Clicca il link qui sotto per aprire il sondaggio:',

        logout: 'Disconnetti',
    },

    button: {
        go_back: 'Torna indietro',
    },

    glossary: {
        missing_content: 'Nessun termine del glossario trovato.',
    },

    privacy: {
        title: 'Privacy',
        privacyPageLink: 'Informativa sulla privacy',
        privacy: 'Informativa sulla privacy',
        grant: "Questo progetto ha ricevuto finanziamenti dal programma di innovazione H2020 dell'Unione Europea nell'ambito dell'accordo di sovvenzione n. 822717.",
        notAvailable: "Il testo dell'informativa sulla privacy non è ancora disponibile.",
        currentStateTitle: 'Preferenze cookie',
        managePreferences: 'Gestisci preferenze',
        pageTitle: 'Privacy',
        pageIntro: '',
        preferencesTitle: 'Impostazioni cookie',
        preferencesDescription: 'Gestisci quali servizi facoltativi vuoi consentire.',
    },

    consent: {
        notice: {
            title: 'Rispettiamo la tua privacy',
            description: "Questa app utilizza cookie e tecnologie simili per erogare i suoi servizi. Alcuni sono essenziali; altri ci aiutano a migliorare la tua esperienza. Puoi accettare tutto, rifiutare quelli facoltativi o gestire le tue preferenze singolarmente.",
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
            necessary: { title: 'Essenziali', description: "Questi cookie sono necessari per il corretto funzionamento dell'app e non possono essere disabilitati." },
            analytics: { title: 'Analisi', description: "Ci aiutano a capire come viene utilizzata l'app per migliorarla. Nessun dato personale viene venduto." },
            embeddedMedia: { title: 'Media incorporati', description: 'Permettono di visualizzare contenuti video e multimediali incorporati da piattaforme esterne come YouTube.' },
            externalMaps: { title: 'Mappe esterne', description: 'Permettono di utilizzare mappe interattive fornite da servizi di terze parti.' },
            thirdPartySupport: { title: 'Strumenti di supporto', description: "Permettono l'utilizzo di strumenti di terze parti per fornire assistenza nell'app." },
        },
        services: {
            usageTracker: { title: "Analisi dell'utilizzo", description: "Raccoglie dati anonimi sulle pagine visitate per migliorare l'app." },
            youtubeEmbed: { title: 'YouTube', description: "Consente la riproduzione di video YouTube incorporati nell'app." },
            atlasEmbed: { title: 'Mappe Atlas', description: 'Fornisce mappe interattive tramite la piattaforma Atlas.' },
            supportWidget: { title: 'Widget di supporto', description: "Abilita la chat di supporto e il widget di aiuto nell'app." },
        },
    },

    // ── Information centre labels ─────────────────────────────────────────────
    information_centre: {
        category: 'Categoria',
        topics: 'Argomenti',
        user_types: 'Tipi di utente',
    },
};