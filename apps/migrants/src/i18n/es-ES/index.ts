/**
 * src/i18n/es/index.ts — Spanish (ES) strings.
 * Mirrors src/i18n/en-US/index.ts exactly — same keys, same structure.
 */

export default {
  failed: 'La acción ha fallado',
  success: 'La acción se ha realizado correctamente',

  // ── Welcome page ──────────────────────────────────────────────────────────
  welcome: {
    start: '¡Empecemos!',
    howItWorks: '¿Cómo funciona esta aplicación?',
    topicContent: 'Elija un tema y encuentre información',
    categoryContent: 'Todo el contenido está clasificado en 3 grupos principales',
    loginContent: 'Si crea una cuenta, las organizaciones públicas podrán ayudarle en su proceso de integración a través de la Cartera de Documentos y los Planes de Integración:',
    noLandingPage: 'No volver a mostrar esta página',
    explore: 'Explorar',
    defaultInfoText: 'Encuentre información básica sobre temas relevantes para su proceso de integración.',
    defaultGuidesText: 'Guías paso a paso para ayudarle con los trámites oficiales.',
    defaultEventText: 'Eventos, cursos y actividades en su zona.',
    defaultDocText: 'Guarde y gestione sus documentos personales de forma segura.',
    defaultPlanText: 'Siga su plan de integración personalizado.',
  },

  // ── Menu / navigation ─────────────────────────────────────────────────────
  menu: {
    home: 'Inicio',
    info: 'Información básica',
    guides: 'Instrucciones paso a paso',
    events: 'Eventos y cursos',
    documents: 'Mis documentos',
    integration_plan: 'Planes de integración',
    glossary: 'Glosario',
    feedback: 'Comentarios',
    about: 'Más',
    profile: 'Perfil',
    settings: 'Ajustes',
    login: 'Iniciar sesión',
    logout: 'Cerrar sesión',
    selectLanguage: 'Seleccionar idioma',
    // About-page navigation items
    welcome: 'Página de bienvenida',
    policy: 'Política de privacidad',
    consent: 'Gestionar cookies',
    funding: 'Financiado por',

    tasks: 'Planes de integración',
  },

  // ── Shared UI labels ──────────────────────────────────────────────────────
  desc_labels: {
    search: 'Buscar',
    loading: 'Cargando…',
    no_results: 'No se han encontrado resultados',
    retry: 'Reintentar',
    survey_desc: 'Rellene nuestra encuesta',
    survey_link: 'Haga clic en el siguiente enlace para abrir la encuesta:',

    logout: 'Cerrar sesión',
  },

  // ── Buttons ───────────────────────────────────────────────────────────────
  button: {
    go_back: 'Volver',
    back: 'Ir al inicio',
  },

  // ── Glossary ──────────────────────────────────────────────────────────────
  glossary: {
    missing_content: 'No se han encontrado términos del glosario.',
  },

  // ── Privacy / consent ─────────────────────────────────────────────────────
  privacy: {
    title: 'Privacidad',
    privacyPageLink: 'Política de privacidad',
    privacy: 'Política de privacidad',
    grant: 'Este proyecto ha recibido financiación del Programa de Innovación H2020 de la Unión Europea en virtud del convenio de subvención n.º 822717.',
    notAvailable: 'El texto de la política de privacidad todavía no está disponible.',
    currentStateTitle: 'Preferencias de cookies',
    managePreferences: 'Gestionar preferencias',
    pageTitle: 'Privacidad',
    pageIntro: '',
    preferencesTitle: 'Configuración de cookies',
    preferencesDescription: 'Gestione qué servicios opcionales permite.',
  },

  // ── Klaro consent manager ─────────────────────────────────────────────────
  consent: {
    notice: {
      title: 'Valoramos su privacidad',
      description: 'Esta aplicación utiliza cookies y tecnologías similares para prestar sus servicios. Algunas son esenciales; otras nos ayudan a mejorar su experiencia. Puede aceptarlas todas, rechazar las opcionales o gestionar sus preferencias individualmente.',
      learnMore: 'Más información',
    },
    modal: {
      title: 'Preferencias de privacidad',
      description: 'Aquí puede consultar y personalizar los permisos que nos concede. Sus opciones se aplican a este dispositivo y navegador.',
      privacyPolicyName: 'política de privacidad',
      privacyPolicyText: 'Para más información, consulte nuestra {privacyPolicy}.',
    },
    actions: {
      ok: 'Aceptar todo',
      acceptAll: 'Aceptar todo',
      decline: 'Rechazar opcionales',
      declineAll: 'Rechazar todo',
      save: 'Guardar preferencias',
      close: 'Cerrar',
    },
    labels: {
      service: 'servicio',
      services: 'servicios',
    },
    purposes: {
      necessary: { title: 'Esenciales', description: 'Estas cookies son necesarias para el correcto funcionamiento de la aplicación y no se pueden desactivar.' },
      analytics: { title: 'Analítica', description: 'Nos ayudan a entender cómo se usa la aplicación para poder mejorarla. No se vende ningún dato personal.' },
      embeddedMedia: { title: 'Contenido multimedia incrustado', description: 'Permite contenido de vídeo y multimedia incrustado desde plataformas externas como YouTube.' },
      externalMaps: { title: 'Mapas externos', description: 'Permite mapas interactivos proporcionados por servicios de terceros.' },
      thirdPartySupport: { title: 'Herramientas de soporte', description: 'Permite herramientas de terceros utilizadas para ofrecer soporte y asistencia dentro de la aplicación.' },
    },
    services: {
      usageTracker: { title: 'Analítica de uso', description: 'Recopila datos anonimizados sobre cómo se visitan las páginas para ayudar a mejorar la aplicación.' },
      youtubeEmbed: { title: 'YouTube', description: 'Permite reproducir vídeos de YouTube incrustados dentro de la aplicación.' },
      atlasEmbed: { title: 'Mapas Atlas', description: 'Proporciona mapas interactivos a través de la plataforma Atlas.' },
      supportWidget: { title: 'Widget de soporte', description: 'Activa el chat de soporte y el widget de ayuda dentro de la aplicación.' },
    },
  },

  // ── Information centre labels ─────────────────────────────────────────────
  information_centre: {
    category: 'Categoría',
    topics: 'Temas',
    user_types: 'Tipos de usuario',
  },

  // ── Event detail labels ──────────────────────────────────────────────────
  event_detail: {
    start_date: 'Fecha de inicio',
    finish_date: 'Fecha de finalización',
    cost: 'Coste',
    cost_free: 'Gratuito',
    location: 'Ubicación',
    organizer: 'Organizador',
    category: 'Categoría',
    topics: 'Temas',
    user_types: 'Tipos de usuario',
  },

  // ── Features ──────────────────────────────────────────────────
  documents: {
    add_document: 'Añadir documento',
    document_type: 'Tipo de documento',
    change_type: 'Cambiar tipo de documento',
    change_image: 'Cambiar imagen',
    delete_image: 'Eliminar imagen',
    upload_new_image: 'Subir nueva imagen',
    shareable_label: 'El documento se puede compartir',
    shareable_hint: 'Los trabajadores sociales de la administración podrán ver este documento.',
    share_label: 'Compartir',
    choose_file: 'Elija un archivo (imagen o PDF)',
    pdf_selected: 'PDF seleccionado',
    no_documents: 'Todavía no hay documentos. Toque "Añadir documento" para subir el primero.',
    not_found: 'Documento no encontrado.',
    issuer: 'Emisor del documento',
    edit_title: 'Editar documento',
    upload_success: 'Documento subido correctamente.',
    save_success: 'Documento guardado.',
    delete_success: 'Documento eliminado.',
    delete_confirm_title: 'Eliminar documento',
    delete_confirm_body: '¿Está seguro de que desea eliminar este documento? Esta acción no se puede deshacer.',
    // Send via email
    send_title: 'Enviar documento por correo electrónico',
    send_subtitle: 'Seleccione una administración pública o introduzca una nueva dirección de correo electrónico',
    select_authority: 'Seleccionar una administración pública',
    different_email: 'Enviar a otra dirección de correo electrónico',
    send_document: 'Enviar documento',
    send_success_prefix: 'Su documento se ha enviado correctamente a:',
    send_error_no_user: 'La dirección de correo electrónico introducida no existe.',
    send_error_generic: 'No se ha podido enviar el documento. Inténtelo de nuevo.',
  },
  features: {
    documents_coming_soon: 'La función de cartera de documentos estará disponible próximamente. Le permitirá guardar y gestionar sus documentos personales de forma segura.',
    tasks_coming_soon: 'La función de plan de integración estará disponible próximamente. Le ayudará a seguir su proceso de integración personalizado paso a paso.',
  },
};
