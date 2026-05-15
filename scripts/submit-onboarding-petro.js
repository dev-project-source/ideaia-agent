#!/usr/bin/env node
// =====================================================================
// Submit onboarding sintético del Dr. Petro a la webapp de producción.
// Genera un Google Sheet completo (16 pestañas) en la Shared Drive.
// El email con el link al sheet llega a: mazuquinconsultas@gmail.com
// =====================================================================
// Uso: node scripts/submit-onboarding-petro.js
// Requiere: Node 18+ (fetch y FormData nativos)
// =====================================================================

const PROD = 'https://ideaia-onboarding-production.up.railway.app';

const formData = {
  base: {
    contactName: 'Dr. Carlos Petro',
    phone: '+57 310 555 0142',
    email: 'mazuquinconsultas@gmail.com',
    brandName: 'Clínica Petro Estética',
    mainObjective: 'agendar',
    agentName: 'Sofía',
  },
  operation: {
    timezone: 'America/Bogota',
    locations: [
      {
        name: 'Sede Principal',
        address: 'Calle 93 # 12-30',
        city: 'Bogotá',
        mapsUrl: 'https://maps.app.goo.gl/petro-93',
        notes: 'Edificio Centro Empresarial 93, piso 5. Recepción en planta baja.',
      },
    ],
    attentionMode: 'presencial',
    attentionHours: ['lun-vie-am', 'lun-vie-pm', 'sab-am'],
    attentionHoursDetail: 'Lunes a viernes 9:00 a 19:00. Sábados 9:00 a 14:00.',
    unavailableDays: ['domingos', 'feriados'],
    unavailableDaysDetail: 'Cerrado domingos y festivos nacionales de Colombia.',
    dailyCapacity: 12,
    leadChannels: ['whatsapp', 'instagram', 'web'],
    googleCalendarConnected: 'no',
    googleCalendarUrl: '',
    standardAppointmentDuration: '45min',
    minBookingNotice: '24h',
    slotsPerWindow: 2,
    preConfirmation: ['24h-antes'],
    confirmationChannel: ['whatsapp'],
    noShowPolicy:
      'Si el paciente no asiste sin previo aviso, se cobra el valor de la valoración ($80.000 COP) en el próximo agendamiento. Si avisa con más de 12 horas de anticipación, se reprograma sin costo.',
  },
  rules: {
    qualifiedLeadCriteria: ['intencion-real', 'problema-claro', 'zona', 'listo-30d'],
    allowedQualificationQuestions: ['ubicacion', 'tiempo', 'horario-modalidad', 'perfil'],
    minDataToAdvance: ['nombre', 'telefono', 'ciudad'],
    ruleIfNotQualified:
      'Agradecer el contacto, ofrecer enviar el portafolio de servicios por WhatsApp y dejar el canal abierto para el futuro. No insistir si declina.',
    canSharePricesInChat: 'desde',
    typicalObjections: ['caro', 'pensar', 'tiempo'],
    discountPolicy:
      'No se ofrecen descuentos sobre el precio de lista. Existen paquetes con precio especial (por ejemplo, 6 sesiones de mesoterapia capilar con 15% de descuento frente al precio individual). Para casos puntuales, escalar al Dr. Petro antes de prometer cualquier ajuste.',
    whenToEscalate: ['molesto', 'sensible', 'pide-humano'],
    escalateTo: 'Dra. Laura Restrepo (asistente médica) — +57 310 555 0143',
    escalationChannel: ['whatsapp'],
    responseSlaTime: '30min',
    whatToSendOnEscalation: ['resumen', 'datos', 'objeciones'],
    plan: 'advanced',
    vertical: 'medical',
    verticalDescription:
      'Clínica de medicina estética especializada en toxina botulínica, rellenos faciales con ácido hialurónico y criolipólisis. Atendemos hombres y mujeres adultos en Bogotá, con foco en resultados naturales y seguimiento personalizado pos-tratamiento.',
  },
  leadFilter: {
    filterObjective:
      'Asegurar que cada agendamiento sea un paciente con intención real, dentro de Bogotá, que entienda el rango de inversión y esté dispuesto a hacer una valoración presencial con el Dr. Petro.',
    qualifiedLeadThreshold: 'balanceado',
    urgencyCriterion: 'media',
    investmentFitCriterion: 'acepta-desde',
    decisionMakerCriterion: 'decisor-directo',
    mainBarrierCriterion: ['precio', 'confianza'],
    blockingQuestionsCriterion: ['fuera-zona', 'no-perfil'],
    allowedActionOnQualify:
      'Confirmar disponibilidad del Dr. Petro para valoración presencial, ofrecer 2 o 3 franjas horarias y confirmar el agendamiento por WhatsApp.',
    notQualifiedReason: ['presupuesto', 'fuera-zona'],
    fullyAutomatedEvents: ['lead-calificado', 'cita-agendada', 'cita-confirmada'],
    saleConfirmationMethod: 'asesor-crm',
    usefulVisitStrictness: 'balanceado',
    minUsefulVisitCriteria: ['intencion', 'contacto', 'fecha-hora'],
    whoConfirmsKeySignals: 'Dra. Laura Restrepo confirma las señales clave en la primera valoración.',
    crmUpdateFrequency: '24h',
    leadDataCaptured: ['nombre', 'telefono', 'ciudad'],
    automaticNurturing: 'si',
    nurturingCycleDuration: '30d',
    nurturingMessageFrequency: 'semanal',
    pauseIfNoResponseAfter: '3',
    nurturingExitEvent: ['intencion', 'pide-agendar'],
  },
  food: {
    operationType: '',
    serviceAreas: '',
    deliveryMode: [],
    mainSalesChannel: '',
    starOffer: '',
    averageTicket: '',
    hasMinOrder: '',
    minOrderAmount: '',
    kitchenHours: '',
    paymentMethods: [],
    qualifiedLeadFood: [],
  },
  medical: {
    serviceTypes: ['consulta', 'sesiones'],
    mainServices:
      '1) Toxina botulínica (botox) en zonas superiores (entrecejo, frente, patas de gallo) e inferiores (mentón, comisuras). 2) Rellenos faciales con ácido hialurónico (labios, surcos nasogenianos, pómulos). 3) Criolipólisis para reducción de grasa localizada en abdomen, flancos y brazos.',
    commonContactReasons: ['precio', 'resultados'],
    requirementsBeforeBooking: ['edad', 'condicion'],
    agendaType: ['val-presencial'],
    paymentReservationPolicy: 'cobra-valoracion',
    qualifiedLeadMedical: ['interes', 'zona', 'agenda'],
  },
  realty: {
    needType: '',
    keyZones: '',
    budgetRange: '',
    decisionTime: '',
    mainBlocker: '',
    qualifiedLeadRealty: [],
  },
  business: {
    whatYouSellAndToWhom: '',
    howClientBuys: '',
    typicalDecisionTime: '',
    mainObjection: '',
    qualifiedLeadBusiness: [],
  },
  reengagement: {
    whenEntersReengagement: ['ghosting', 'lo-pienso', 'no-show'],
    maxCycleLimit: '30d',
    contactFrequency: 'una-vez-semana',
    maxAttemptsWithoutResponse: '3',
    reengagementChannel: ['whatsapp'],
    whatIsAllowedToSend: ['recordatorio', 'testimonio', 'educativo'],
    whatIsNotAllowed: ['insistir', 'prometer', 'descuentos'],
    route: 'ruta-a',
    routeAObjective:
      'Reagendar la valoración presencial perdida o aplazada, con foco en resolver la objeción puntual que frenó el cierre original (precio, miedo o dudas sobre el procedimiento).',
    routeBObjective: '',
    whenConsideredRecovered: ['responde', 'reagendar'],
    ifSaysAlreadyResolved: 'preguntar-futuro',
    humanResponsibleForNotification: 'Dra. Laura Restrepo',
  },
  style: {
    restrictionsToRespect: ['no-prometer', 'no-diagnostico', 'no-antes-despues', 'no-descuentos'],
    forbiddenPhrases: ['prometer-resultados', 'diagnostico', 'descuentos'],
    sensitiveTopics: ['menores', 'salud'],
    officialLinks: 'Instagram: https://instagram.com/clinicapetroestetica · Web: https://clinicapetro.com',
    materials: [
      { kind: 'catalogo', files: [], note: '' },
      {
        kind: 'portafolio',
        files: [],
        note: 'Portafolio de fotos antes/después disponible solo en consulta presencial por confidencialidad médica.',
      },
      { kind: 'faq', files: [], note: '' },
      { kind: 'precios', files: [], note: 'Precios actualizados al primer trimestre 2026.' },
      {
        kind: 'testimonios',
        files: [],
        note: 'Tenemos testimonios en Instagram y reseñas verificadas en Google Maps.',
      },
      { kind: 'fotos-resultados', files: [], note: '' },
      { kind: 'politicas-garantia', files: [], note: '' },
    ],
    voiceRecordings: [],
    gptTrainingFiles: [],
    scenariosToHandle: [],
    whatToDoInThoseCases: [],
    escalationConfirmationTo: '',
    approvedEscalationMessage:
      'Hola, te paso con la Dra. Laura Restrepo, asistente del Dr. Petro, para que coordine los próximos pasos contigo personalmente. Te escribe en los próximos 30 minutos.',
    termsAccepted: true,
  },
};

(async () => {
  if (typeof fetch !== 'function' || typeof FormData !== 'function') {
    console.error('Requiere Node 18+ (fetch y FormData nativos).');
    process.exit(1);
  }

  const fd = new FormData();
  fd.append('formData', JSON.stringify(formData));

  console.log('[POST] enviando onboarding sintético del Dr. Petro a producción...');
  console.log('       email destino:', formData.base.email);

  let res;
  try {
    res = await fetch(`${PROD}/api/onboarding`, { method: 'POST', body: fd });
  } catch (err) {
    console.error('FAIL fetch:', err.message);
    process.exit(1);
  }

  const text = await res.text();
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    body = text;
  }

  console.log(`[POST] HTTP ${res.status}`);
  console.log('[POST] body:', body);

  if (res.status >= 200 && res.status < 300 && body && body.onboardingId) {
    console.log('');
    console.log('================================================================');
    console.log('✓ Onboarding aceptado. Pipeline async corriendo (~18-27 segundos).');
    console.log('================================================================');
    console.log('  → onboardingId:', body.onboardingId);
    console.log('  → email del cliente (link al sheet):', formData.base.email);
    console.log('  → email interno (PDF + client_spec):', 'dev-project@ideaia.app (RESEND_INTERNAL_TO)');
    console.log('');
    console.log('Próximos pasos:');
    console.log('  1. Esperar 25-40 seg.');
    console.log('  2. Revisar inbox de mazuquinconsultas@gmail.com.');
    console.log('  3. Abrir el sheet, copiar el spreadsheetId de la URL.');
    console.log('  4. Pasarlo al chat de Claude para continuar Día 2.');
  } else {
    console.error('FAIL: respuesta inesperada');
    process.exit(1);
  }
})();
