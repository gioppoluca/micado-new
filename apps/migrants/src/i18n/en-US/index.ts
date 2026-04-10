/**
 * src/i18n/en-US/index.ts
 *
 * English (US) base translation strings.
 * All other locale files should mirror this structure.
 */

export default {
  // ── Generic ───────────────────────────────────────────────────────────────
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
    about: 'About',
    profile: 'Profile',
    settings: 'Settings',
    login: 'Login',
    logout: 'Logout',
    selectLanguage: 'Select language',
  },

  // ── Shared UI labels ──────────────────────────────────────────────────────
  desc_labels: {
    search: 'Search',
    loading: 'Loading…',
    no_results: 'No results found',
    retry: 'Retry',
  },

  // ── Glossary ──────────────────────────────────────────────────────────────
  glossary: {
    missing_content: 'No glossary terms found.',
  },

  // ── Privacy / consent ─────────────────────────────────────────────────────
  privacy: {
    title: 'Privacy',
    privacyPageLink: 'Privacy Policy',
  },

  // ── Klaro consent manager ─────────────────────────────────────────────────
  // Keys are consumed by klaro-config.factory.ts via the t() function.
  // Structure must match the Klaro translation schema exactly.
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
      necessary: {
        title: 'Essential',
        description: 'These cookies are required for the app to function correctly and cannot be disabled.',
      },
      analytics: {
        title: 'Analytics',
        description: 'Help us understand how the app is used so we can improve it. No personal data is sold.',
      },
      embeddedMedia: {
        title: 'Embedded media',
        description: 'Allow video and media content embedded from external platforms such as YouTube.',
      },
      externalMaps: {
        title: 'External maps',
        description: 'Allow interactive maps provided by third-party services.',
      },
      thirdPartySupport: {
        title: 'Support tools',
        description: 'Allow third-party tools used to provide in-app support and assistance.',
      },
    },
    services: {
      usageTracker: {
        title: 'Usage analytics',
        description: 'Collects anonymised data about how pages are visited to help improve the app.',
      },
      youtubeEmbed: {
        title: 'YouTube',
        description: 'Allows embedded YouTube videos to be played inside the app.',
      },
      atlasEmbed: {
        title: 'Atlas maps',
        description: 'Provides interactive maps via the Atlas platform.',
      },
      supportWidget: {
        title: 'Support widget',
        description: 'Enables the in-app support chat and help widget.',
      },
    },
  },
};