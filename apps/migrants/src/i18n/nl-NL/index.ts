/**
 * src/i18n/nl/index.ts — Dutch (NL) strings.
 * Mirrors src/i18n/en-US/index.ts exactly — same keys, same structure.
 */

export default {
  failed: 'Actie mislukt',
  success: 'Actie geslaagd',

  // ── Welcome page ──────────────────────────────────────────────────────────
  welcome: {
    start: 'Laten we beginnen!',
    howItWorks: 'Hoe werkt deze app?',
    topicContent: 'Kies een onderwerp en zoek informatie',
    categoryContent: 'Alle inhoud is ingedeeld in 3 hoofdgroepen',
    loginContent: 'Als u een account aanmaakt, kunnen overheidsinstanties u helpen bij uw integratieproces via de Documentenmap & Integratieplannen:',
    noLandingPage: 'Deze pagina niet meer tonen',
    explore: 'Verkennen',
    defaultInfoText: 'Vind basisinformatie over onderwerpen die relevant zijn voor uw integratietraject.',
    defaultGuidesText: 'Stapsgewijze handleidingen om u te helpen bij officiële procedures.',
    defaultEventText: 'Evenementen, cursussen en activiteiten in uw omgeving.',
    defaultDocText: 'Bewaar en beheer uw persoonlijke documenten veilig.',
    defaultPlanText: 'Volg uw persoonlijke integratieplan.',
  },

  // ── Menu / navigation ─────────────────────────────────────────────────────
  menu: {
    home: 'Home',
    info: 'Basisinformatie',
    guides: 'Stapsgewijze instructies',
    events: 'Evenementen & cursussen',
    documents: 'Mijn documenten',
    integration_plan: 'Integratieplannen',
    glossary: 'Woordenlijst',
    feedback: 'Feedback',
    about: 'Meer',
    profile: 'Profiel',
    settings: 'Instellingen',
    login: 'Inloggen',
    logout: 'Uitloggen',
    selectLanguage: 'Taal selecteren',
    // About-page navigation items
    welcome: 'Welkomstpagina',
    policy: 'Privacybeleid',
    consent: 'Cookies beheren',
    funding: 'Mogelijk gemaakt door / Financiering',

    tasks: 'Integratieplannen',
  },

  // ── Shared UI labels ──────────────────────────────────────────────────────
  desc_labels: {
    search: 'Zoeken',
    loading: 'Bezig met laden…',
    no_results: 'Geen resultaten gevonden',
    retry: 'Opnieuw proberen',
    survey_desc: 'Vul onze enquête in',
    survey_link: 'Klik op onderstaande link om de enquête te openen:',

    logout: 'Uitloggen',
  },

  // ── Buttons ───────────────────────────────────────────────────────────────
  button: {
    go_back: 'Terug',
    back: 'Naar home',
  },

  // ── Glossary ──────────────────────────────────────────────────────────────
  glossary: {
    missing_content: 'Geen begrippen gevonden.',
  },

  // ── Privacy / consent ─────────────────────────────────────────────────────
  privacy: {
    title: 'Privacy',
    privacyPageLink: 'Privacybeleid',
    privacy: 'Privacybeleid',
    grant: 'Dit project heeft financiering ontvangen van de Innovation Action H2020 van de Europese Unie onder subsidieovereenkomst nr. 822717.',
    notAvailable: 'De tekst van het privacybeleid is nog niet beschikbaar.',
    currentStateTitle: 'Cookievoorkeuren',
    managePreferences: 'Voorkeuren beheren',
    pageTitle: 'Privacy',
    pageIntro: '',
    preferencesTitle: 'Cookie-instellingen',
    preferencesDescription: 'Beheer welke optionele diensten u toestaat.',
  },

  // ── Klaro consent manager ─────────────────────────────────────────────────
  consent: {
    notice: {
      title: 'Wij hechten waarde aan uw privacy',
      description: 'Deze app gebruikt cookies en vergelijkbare technologieën om haar diensten te leveren. Sommige zijn essentieel; andere helpen ons uw ervaring te verbeteren. U kunt alles accepteren, optionele cookies weigeren of uw voorkeuren afzonderlijk beheren.',
      learnMore: 'Meer informatie',
    },
    modal: {
      title: 'Privacyvoorkeuren',
      description: 'Hier kunt u de machtigingen die u ons verleent bekijken en aanpassen. Uw keuzes gelden voor dit apparaat en deze browser.',
      privacyPolicyName: 'privacybeleid',
      privacyPolicyText: 'Lees voor meer informatie ons {privacyPolicy}.',
    },
    actions: {
      ok: 'Alles accepteren',
      acceptAll: 'Alles accepteren',
      decline: 'Optionele weigeren',
      declineAll: 'Alles weigeren',
      save: 'Voorkeuren opslaan',
      close: 'Sluiten',
    },
    labels: {
      service: 'dienst',
      services: 'diensten',
    },
    purposes: {
      necessary: { title: 'Essentieel', description: 'Deze cookies zijn nodig om de app goed te laten werken en kunnen niet worden uitgeschakeld.' },
      analytics: { title: 'Analyse', description: 'Helpen ons begrijpen hoe de app wordt gebruikt, zodat we deze kunnen verbeteren. Er worden geen persoonsgegevens verkocht.' },
      embeddedMedia: { title: 'Ingesloten media', description: 'Staat video- en media-inhoud toe die is ingesloten vanaf externe platforms zoals YouTube.' },
      externalMaps: { title: 'Externe kaarten', description: 'Staat interactieve kaarten toe die worden aangeboden door diensten van derden.' },
      thirdPartySupport: { title: 'Ondersteuningstools', description: 'Staat tools van derden toe die worden gebruikt voor ondersteuning en hulp binnen de app.' },
    },
    services: {
      usageTracker: { title: 'Gebruiksanalyse', description: "Verzamelt geanonimiseerde gegevens over hoe pagina's worden bezocht om de app te helpen verbeteren." },
      youtubeEmbed: { title: 'YouTube', description: "Maakt het mogelijk ingesloten YouTube-video's binnen de app af te spelen." },
      atlasEmbed: { title: 'Atlas-kaarten', description: 'Biedt interactieve kaarten via het Atlas-platform.' },
      supportWidget: { title: 'Ondersteuningswidget', description: 'Schakelt de ondersteuningschat en hulp-widget in de app in.' },
    },
  },

  // ── Information centre labels ─────────────────────────────────────────────
  information_centre: {
    category: 'Categorie',
    topics: 'Onderwerpen',
    user_types: 'Gebruikerstypen',
  },

  // ── Event detail labels ──────────────────────────────────────────────────
  event_detail: {
    start_date: 'Startdatum',
    finish_date: 'Einddatum',
    cost: 'Kosten',
    cost_free: 'Gratis',
    location: 'Locatie',
    organizer: 'Organisator',
    category: 'Categorie',
    topics: 'Onderwerpen',
    user_types: 'Gebruikerstypen',
  },

  // ── Features ──────────────────────────────────────────────────
  documents: {
    add_document: 'Document toevoegen',
    document_type: 'Documenttype',
    change_type: 'Documenttype wijzigen',
    change_image: 'Afbeelding wijzigen',
    delete_image: 'Afbeelding verwijderen',
    upload_new_image: 'Nieuwe afbeelding uploaden',
    shareable_label: 'Document is deelbaar',
    shareable_hint: 'Maatschappelijk werkers van de overheidsinstantie kunnen dit document zien.',
    share_label: 'Delen',
    choose_file: 'Kies een bestand (afbeelding of pdf)',
    pdf_selected: 'PDF geselecteerd',
    no_documents: 'Nog geen documenten. Tik op "Document toevoegen" om uw eerste document te uploaden.',
    not_found: 'Document niet gevonden.',
    issuer: 'Uitgever van het document',
    edit_title: 'Document bewerken',
    upload_success: 'Document succesvol geüpload.',
    save_success: 'Document opgeslagen.',
    delete_success: 'Document verwijderd.',
    delete_confirm_title: 'Document verwijderen',
    delete_confirm_body: 'Weet u zeker dat u dit document wilt verwijderen? Deze actie kan niet ongedaan worden gemaakt.',
    // Send via email
    send_title: 'Document per e-mail verzenden',
    send_subtitle: 'Selecteer een overheidsinstantie of voer een nieuw e-mailadres in',
    select_authority: 'Selecteer een overheidsinstantie',
    different_email: 'Naar een ander e-mailadres verzenden',
    send_document: 'Document verzenden',
    send_success_prefix: 'Uw document is succesvol verzonden naar:',
    send_error_no_user: 'Het opgegeven e-mailadres bestaat niet.',
    send_error_generic: 'Het document kon niet worden verzonden. Probeer het opnieuw.',
  },
  features: {
    documents_coming_soon: 'De documentenmap komt binnenkort beschikbaar. Hiermee kunt u uw persoonlijke documenten veilig opslaan en beheren.',
    tasks_coming_soon: 'De functie integratieplan komt binnenkort beschikbaar. Deze helpt u uw persoonlijke integratietraject stap voor stap te volgen.',
  },
};
