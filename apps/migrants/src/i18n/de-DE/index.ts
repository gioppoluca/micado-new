/**
 * src/i18n/de/index.ts — German (DE) strings.
 * Mirrors src/i18n/en-US/index.ts exactly — same keys, same structure.
 */

export default {
  failed: 'Aktion fehlgeschlagen',
  success: 'Aktion war erfolgreich',

  // ── Welcome page ──────────────────────────────────────────────────────────
  welcome: {
    start: "Los geht's!",
    howItWorks: 'Wie funktioniert diese App?',
    topicContent: 'Wählen Sie ein Thema und finden Sie Informationen',
    categoryContent: 'Alle Inhalte sind in 3 Hauptgruppen unterteilt',
    loginContent: 'Wenn Sie ein Konto erstellen, können öffentliche Einrichtungen Ihnen über die Dokumentenmappe & Integrationspläne bei Ihrem Integrationsprozess helfen:',
    noLandingPage: 'Diese Seite nicht mehr anzeigen',
    explore: 'Entdecken',
    defaultInfoText: 'Finden Sie grundlegende Informationen zu Themen, die für Ihren Integrationsweg relevant sind.',
    defaultGuidesText: 'Schritt-für-Schritt-Anleitungen, die Ihnen bei offiziellen Verfahren helfen.',
    defaultEventText: 'Veranstaltungen, Kurse und Aktivitäten in Ihrer Umgebung.',
    defaultDocText: 'Speichern und verwalten Sie Ihre persönlichen Dokumente sicher.',
    defaultPlanText: 'Verfolgen Sie Ihren persönlichen Integrationsplan.',
  },

  // ── Menu / navigation ─────────────────────────────────────────────────────
  menu: {
    home: 'Startseite',
    info: 'Grundlegende Informationen',
    guides: 'Schritt-für-Schritt-Anleitungen',
    events: 'Veranstaltungen & Kurse',
    documents: 'Meine Dokumente',
    integration_plan: 'Integrationspläne',
    glossary: 'Glossar',
    feedback: 'Feedback',
    about: 'Mehr',
    profile: 'Profil',
    settings: 'Einstellungen',
    login: 'Anmelden',
    logout: 'Abmelden',
    selectLanguage: 'Sprache auswählen',
    // About-page navigation items
    welcome: 'Willkommensseite',
    policy: 'Datenschutzerklärung',
    consent: 'Cookies verwalten',
    funding: 'Unterstützt von / Finanzierung',

    tasks: 'Integrationspläne',
  },

  // ── Shared UI labels ──────────────────────────────────────────────────────
  desc_labels: {
    search: 'Suche',
    loading: 'Wird geladen…',
    no_results: 'Keine Ergebnisse gefunden',
    retry: 'Erneut versuchen',
    survey_desc: 'Nehmen Sie an unserer Umfrage teil',
    survey_link: 'Klicken Sie auf den folgenden Link, um die Umfrage zu öffnen:',

    logout: 'Abmelden',
  },

  // ── Buttons ───────────────────────────────────────────────────────────────
  button: {
    go_back: 'Zurück',
    back: 'Zur Startseite',
  },

  // ── Glossary ──────────────────────────────────────────────────────────────
  glossary: {
    missing_content: 'Keine Glossareinträge gefunden.',
  },

  // ── Privacy / consent ─────────────────────────────────────────────────────
  privacy: {
    title: 'Datenschutz',
    privacyPageLink: 'Datenschutzerklärung',
    privacy: 'Datenschutzerklärung',
    grant: "Dieses Projekt wurde im Rahmen des Innovationsprogramms Horizont 2020 der Europäischen Union unter der Finanzhilfevereinbarung Nr. 822717 gefördert.",
    notAvailable: 'Der Text der Datenschutzerklärung ist noch nicht verfügbar.',
    currentStateTitle: 'Cookie-Einstellungen',
    managePreferences: 'Einstellungen verwalten',
    pageTitle: 'Datenschutz',
    pageIntro: '',
    preferencesTitle: 'Cookie-Einstellungen',
    preferencesDescription: 'Verwalten Sie, welche optionalen Dienste Sie zulassen.',
  },

  // ── Klaro consent manager ─────────────────────────────────────────────────
  consent: {
    notice: {
      title: 'Wir legen Wert auf Ihre Privatsphäre',
      description: 'Diese App verwendet Cookies und ähnliche Technologien, um ihre Dienste bereitzustellen. Einige sind unbedingt erforderlich, andere helfen uns, Ihre Erfahrung zu verbessern. Sie können alle akzeptieren, optionale ablehnen oder Ihre Einstellungen individuell verwalten.',
      learnMore: 'Mehr erfahren',
    },
    modal: {
      title: 'Datenschutzeinstellungen',
      description: 'Hier können Sie die uns erteilten Berechtigungen einsehen und anpassen. Ihre Auswahl gilt für dieses Gerät und diesen Browser.',
      privacyPolicyName: 'Datenschutzerklärung',
      privacyPolicyText: 'Ausführliche Informationen finden Sie in unserer {privacyPolicy}.',
    },
    actions: {
      ok: 'Alle akzeptieren',
      acceptAll: 'Alle akzeptieren',
      decline: 'Optionale ablehnen',
      declineAll: 'Alle ablehnen',
      save: 'Einstellungen speichern',
      close: 'Schließen',
    },
    labels: {
      service: 'Dienst',
      services: 'Dienste',
    },
    purposes: {
      necessary: { title: 'Erforderlich', description: 'Diese Cookies sind für die korrekte Funktion der App erforderlich und können nicht deaktiviert werden.' },
      analytics: { title: 'Analyse', description: 'Helfen uns zu verstehen, wie die App genutzt wird, damit wir sie verbessern können. Es werden keine personenbezogenen Daten verkauft.' },
      embeddedMedia: { title: 'Eingebettete Medien', description: 'Ermöglicht Video- und Medieninhalte, die von externen Plattformen wie YouTube eingebettet werden.' },
      externalMaps: { title: 'Externe Karten', description: 'Ermöglicht interaktive Karten von Drittanbietern.' },
      thirdPartySupport: { title: 'Support-Tools', description: 'Ermöglicht Tools von Drittanbietern, die In-App-Support und Hilfestellung bieten.' },
    },
    services: {
      usageTracker: { title: 'Nutzungsanalyse', description: 'Erfasst anonymisierte Daten darüber, wie Seiten aufgerufen werden, um die App zu verbessern.' },
      youtubeEmbed: { title: 'YouTube', description: 'Ermöglicht die Wiedergabe eingebetteter YouTube-Videos innerhalb der App.' },
      atlasEmbed: { title: 'Atlas-Karten', description: 'Stellt interaktive Karten über die Atlas-Plattform bereit.' },
      supportWidget: { title: 'Support-Widget', description: 'Aktiviert den In-App-Support-Chat und das Hilfe-Widget.' },
    },
  },

  // ── Information centre labels ─────────────────────────────────────────────
  information_centre: {
    category: 'Kategorie',
    topics: 'Themen',
    user_types: 'Nutzertypen',
  },

  // ── Event detail labels ──────────────────────────────────────────────────
  event_detail: {
    start_date: 'Startdatum',
    finish_date: 'Enddatum',
    cost: 'Kosten',
    cost_free: 'Kostenlos',
    location: 'Ort',
    organizer: 'Veranstalter',
    category: 'Kategorie',
    topics: 'Themen',
    user_types: 'Nutzertypen',
  },

  // ── Features ──────────────────────────────────────────────────
  documents: {
    add_document: 'Dokument hinzufügen',
    document_type: 'Dokumenttyp',
    change_type: 'Dokumenttyp ändern',
    change_image: 'Bild ändern',
    delete_image: 'Bild löschen',
    upload_new_image: 'Neues Bild hochladen',
    shareable_label: 'Dokument ist freigebbar',
    shareable_hint: 'Sozialarbeiter der Behörde können dieses Dokument einsehen.',
    share_label: 'Teilen',
    choose_file: 'Datei auswählen (Bild oder PDF)',
    pdf_selected: 'PDF ausgewählt',
    no_documents: 'Noch keine Dokumente vorhanden. Tippen Sie auf „Dokument hinzufügen", um Ihr erstes Dokument hochzuladen.',
    not_found: 'Dokument nicht gefunden.',
    issuer: 'Aussteller des Dokuments',
    edit_title: 'Dokument bearbeiten',
    upload_success: 'Dokument erfolgreich hochgeladen.',
    save_success: 'Dokument gespeichert.',
    delete_success: 'Dokument gelöscht.',
    delete_confirm_title: 'Dokument löschen',
    delete_confirm_body: 'Sind Sie sicher, dass Sie dieses Dokument löschen möchten? Diese Aktion kann nicht rückgängig gemacht werden.',
    // Send via email
    send_title: 'Dokument per E-Mail senden',
    send_subtitle: 'Wählen Sie eine Behörde aus oder geben Sie eine neue E-Mail-Adresse ein',
    select_authority: 'Behörde auswählen',
    different_email: 'An eine andere E-Mail-Adresse senden',
    send_document: 'Dokument senden',
    send_success_prefix: 'Ihr Dokument wurde erfolgreich gesendet an:',
    send_error_no_user: 'Die eingegebene E-Mail-Adresse existiert nicht.',
    send_error_generic: 'Das Dokument konnte nicht gesendet werden. Bitte versuchen Sie es erneut.',
  },
  features: {
    documents_coming_soon: 'Die Dokumentenmappe steht demnächst zur Verfügung. Damit können Sie Ihre persönlichen Dokumente sicher speichern und verwalten.',
    tasks_coming_soon: 'Die Funktion Integrationsplan steht demnächst zur Verfügung. Sie hilft Ihnen, Ihren persönlichen Integrationsweg Schritt für Schritt zu verfolgen.',
  },
};
