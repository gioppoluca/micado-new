/**
 * src/i18n/en-US/index.ts — English (US) base strings.
 * All other locale files mirror this structure exactly.
 */

export default {
  failed: 'Action failed',
  success: 'Action was successful',

  // ── Welcome page ──────────────────────────────────────────────────────────
  welcome: {
    start: "Let's get started!",
    howItWorks: 'How does this app work?',
    topicContent: 'Choose a topic and find information',
    categoryContent: 'All content is categorised in 3 main groups',
    loginContent: 'If you create an account, public organizations are able to help you with your integration processes through the Document Wallet & Integration Plans:',
    noLandingPage: "Don't show this page again",
    explore: 'Explore',
    defaultInfoText: 'Find basic information about topics relevant to your integration journey.',
    defaultGuidesText: 'Step-by-step guides to help you navigate official procedures.',
    defaultEventText: 'Events, courses and activities in your area.',
    defaultDocText: 'Store and manage your personal documents securely.',
    defaultPlanText: 'Follow your personalised integration plan.',
  },

  // ── Menu / navigation ─────────────────────────────────────────────────────
  menu: {
    home: 'Home',
    info: 'Basic Information',
    guides: 'Step-by-Step Instructions',
    events: 'Events & Courses',
    documents: 'My Documents',
    integration_plan: 'Integration Plans',
    glossary: 'Glossary',
    feedback: 'Feedback',
    about: 'More',
    profile: 'Profile',
    settings: 'Settings',
    login: 'Login',
    logout: 'Logout',
    selectLanguage: 'Select language',
    // About-page navigation items
    welcome: 'Welcome page',
    policy: 'Privacy policy',
    consent: 'Manage cookies',
    funding: 'Powered by / Funding',

    tasks: 'Integration Plans',
  },

  // ── Shared UI labels ──────────────────────────────────────────────────────
  desc_labels: {
    search: 'Search',
    loading: 'Loading…',
    no_results: 'No results found',
    retry: 'Retry',
    survey_desc: 'Fill in our survey',
    survey_link: 'Click the link below to open the survey:',

    logout: 'Sign out',
  },

  // ── Buttons ───────────────────────────────────────────────────────────────
  button: {
    go_back: 'Go back',
    back: 'Go Home',
  },

  // ── Glossary ──────────────────────────────────────────────────────────────
  glossary: {
    missing_content: 'No glossary terms found.',
  },

  // ── Privacy / consent ─────────────────────────────────────────────────────
  privacy: {
    title: 'Privacy',
    privacyPageLink: 'Privacy Policy',
    privacy: 'Privacy Policy',
    grant: "This project has received funding from the European Union's H2020 Innovation Action under Grant Agreement No 822717.",
    notAvailable: 'Privacy policy text is not yet available.',
    currentStateTitle: 'Cookie preferences',
    managePreferences: 'Manage preferences',
    pageTitle: 'Privacy',
    pageIntro: '',
    preferencesTitle: 'Cookie settings',
    preferencesDescription: 'Manage which optional services you allow.',
  },

  // ── Klaro consent manager ─────────────────────────────────────────────────
  consent: {
    notice: {
      title: 'We value your privacy',
      description: 'This app uses cookies and similar technologies to provide its services. Some are essential; others help us improve your experience. You can accept all, decline optional ones, or manage your preferences individually.',
      learnMore: 'Learn more',
    },
    modal: {
      title: 'Privacy preferences',
      description: 'Here you can review and customise the permissions you grant us. Your choices apply to this device and browser.',
      privacyPolicyName: 'privacy policy',
      privacyPolicyText: 'For full details, please read our {privacyPolicy}.',
    },
    actions: {
      ok: 'Accept all',
      acceptAll: 'Accept all',
      decline: 'Decline optional',
      declineAll: 'Decline all',
      save: 'Save preferences',
      close: 'Close',
    },
    labels: {
      service: 'service',
      services: 'services',
    },
    purposes: {
      necessary: { title: 'Essential', description: 'These cookies are required for the app to function correctly and cannot be disabled.' },
      analytics: { title: 'Analytics', description: 'Help us understand how the app is used so we can improve it. No personal data is sold.' },
      embeddedMedia: { title: 'Embedded media', description: 'Allow video and media content embedded from external platforms such as YouTube.' },
      externalMaps: { title: 'External maps', description: 'Allow interactive maps provided by third-party services.' },
      thirdPartySupport: { title: 'Support tools', description: 'Allow third-party tools used to provide in-app support and assistance.' },
    },
    services: {
      usageTracker: { title: 'Usage analytics', description: 'Collects anonymised data about how pages are visited to help improve the app.' },
      youtubeEmbed: { title: 'YouTube', description: 'Allows embedded YouTube videos to be played inside the app.' },
      atlasEmbed: { title: 'Atlas maps', description: 'Provides interactive maps via the Atlas platform.' },
      supportWidget: { title: 'Support widget', description: 'Enables the in-app support chat and help widget.' },
    },
  },

  // ── Information centre labels ─────────────────────────────────────────────
  information_centre: {
    category: 'Category',
    topics: 'Topics',
    user_types: 'User types',
  },

  // ── Event detail labels ──────────────────────────────────────────────────
  event_detail: {
    start_date: 'Start date',
    finish_date: 'End date',
    cost: 'Cost',
    cost_free: 'Free',
    location: 'Location',
    organizer: 'Organizer',
    category: 'Category',
    topics: 'Topics',
    user_types: 'User types',
  },

  // ── Features ──────────────────────────────────────────────────
  features: {
    documents_coming_soon: 'The document wallet feature is coming soon. It will allow you to securely store and manage your personal documents.',
    tasks_coming_soon: 'The integration plan feature is coming soon. It will help you track your personalised integration journey step by step.',
  },
};