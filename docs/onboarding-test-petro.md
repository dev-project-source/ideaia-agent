# Onboarding sintético — Dr. Petro (clínica de estética)

Guion de respuestas plausibles para correr el onboarding **una vez** en `https://onboarding.ideaia.app` y obtener un sheet con la estructura completa del KB. Estos datos son **ficticios pero coherentes** con un cliente real de medicina estética en Bogotá. Cuando llegue el cliente real, se hace otro onboarding y se reemplaza el sheet.

**Tiempo estimado:** 10-15 min de copy-paste.

**Importante:** poné tu propio email (`recursos@idealidad.co`) en `email` del slide 1 — así te llega el link al sheet a tu inbox.

---

## Diapo 1 — Configuración base

| Campo | Valor |
|---|---|
| `contactName` | Carlos Petro |
| `phone` | +57 310 555 0142 |
| `email` | **recursos@idealidad.co** *(tu email real, para recibir el sheet)* |
| `brandName` | Clínica Petro Estética |
| `mainObjective` | `agendar` |
| `agentName` | Sofía |

---

## Diapo 2 — Operación y agenda

| Campo | Valor |
|---|---|
| `timezone` | `America/Bogota` |
| `mainCity` | Bogotá |
| `attentionMode` | `presencial` |
| `attentionHours` | tildá: `lun-vie-normal`, `sabados` |
| `attentionHoursDetail` | Lunes a viernes 9:00 a 19:00. Sábados 9:00 a 14:00. |
| `unavailableDays` | tildá: `festivos`, `domingos` |
| `dailyCapacity` | `12` |
| `leadChannels` | tildá: `whatsapp`, `instagram`, `web` |
| `googleCalendarConnected` | `no` |
| `standardAppointmentDuration` | `45` |
| `minBookingNotice` | `24h` |
| `slotsPerWindow` | `2` *(opcional, ponelo)* |
| `preConfirmation` | tildá: `24h-antes` |
| `confirmationChannel` | tildá: `whatsapp` |
| `noShowPolicy` | Si el paciente no asiste sin previo aviso, se cobra el valor de la valoración ($80.000) en el próximo agendamiento. Si avisa con más de 12 horas, se reprograma sin costo. |

---

## Diapo 3 — Reglas de decisión

| Campo | Valor |
|---|---|
| `qualifiedLeadCriteria` | tildá: `intencion-real`, `problema-claro`, `zona`, `listo-30d` |
| `allowedQualificationQuestions` | tildá: `ubicacion`, `tiempo`, `horario-modalidad`, `perfil` |
| `minDataToAdvance` | tildá: `nombre`, `telefono`, `ciudad` |
| `ruleIfNotQualified` | Agradecer el contacto, enviar el portafolio de servicios por WhatsApp y dejar canal abierto. No insistir si declina. |
| `canSharePricesInChat` | `desde` |
| `minPriceFrom` | Desde $300.000 (peeling). Botox desde $800.000. Rellenos desde $1.500.000. |
| `typicalObjections` | tildá: `caro`, `pensar`, `tiempo` |
| `discountPolicy` | No se ofrecen descuentos sobre precio de lista. Hay paquetes con precio especial (ej. 6 sesiones de mesoterapia con 15% off vs precio individual). Para casos puntuales, escalar al Dr. Petro antes de prometer nada. |
| `whenToEscalate` | tildá: `molesto`, `sensible`, `pide-humano` |
| `escalateTo` | Dra. Laura Restrepo (asistente médica) |
| `escalationChannel` | tildá: `whatsapp` |
| `responseSlaTime` | `30min` |
| `whatToSendOnEscalation` | tildá: `resumen`, `datos`, `objeciones` |
| `plan` | `advanced` *(viene fijo por default)* |
| `vertical` | `medical` |

---

## Diapo 4 — IDEA Filtro de Leads

| Campo | Valor |
|---|---|
| `filterObjective` | Asegurar que cada agendamiento sea un paciente con intención real, dentro de Bogotá, que entienda el rango de inversión y esté dispuesto a hacer una valoración presencial. |
| `qualifiedLeadThreshold` | `balanceado` |
| `urgencyCriterion` | `media` |
| `investmentFitCriterion` | `acepta-desde` |
| `decisionMakerCriterion` | `decisor-directo` |
| `mainBarrierCriterion` | tildá: `precio`, `confianza` |
| `blockingQuestionsCriterion` | tildá: `fuera-zona`, `no-perfil` |
| `allowedActionOnQualify` | Confirmar disponibilidad del Dr. Petro para valoración presencial, ofrecer 2-3 franjas horarias y confirmar agendamiento. |
| `notQualifiedReason` | tildá: `presupuesto`, `fuera-zona` |
| `fullyAutomatedEvents` | tildá: `lead-calificado`, `cita-agendada`, `cita-confirmada` |
| `saleConfirmationMethod` | `asesor-crm` |
| `usefulVisitStrictness` | `balanceado` |
| `minUsefulVisitCriteria` | tildá: `intencion`, `contacto`, `fecha-hora` |
| `whoConfirmsKeySignals` | Dra. Laura Restrepo |
| `crmUpdateFrequency` | `24h` |
| `leadDataCaptured` | tildá: `telefono`, `nombre-apellido`, `ciudad` |
| `automaticNurturing` | `si` |
| `nurturingCycleDuration` | `30d` |
| `nurturingMessageFrequency` | `semanal` |
| `pauseIfNoResponseAfter` | `3` |
| `nurturingExitEvent` | tildá: `intencion`, `pide-agendar` |

---

## Diapo 6 — IDEA MEDICAL *(la única vertical visible porque elegiste `medical`)*

| Campo | Valor |
|---|---|
| `serviceTypes` | tildá: `consulta`, `sesiones` |
| `mainServices` | 1) Toxina botulínica (botox) zonas superiores e inferiores. 2) Rellenos faciales con ácido hialurónico (labios, surcos, pómulos). 3) Criolipólisis para reducción localizada de grasa. |
| `commonContactReasons` | tildá: `precio`, `resultados` |
| `requirementsBeforeBooking` | tildá: `edad`, `condicion` |
| `agendaType` | `val-costo` |
| `paymentReservationPolicy` | `cobra-valoracion` |
| `commonObjections` | tildá: `precio`, `miedo`, `recuperacion` |
| `qualifiedLeadMedical` | tildá: `interes`, `zona`, `agenda` |

---

## Diapo 9 — Reenganche inteligente *(visible porque plan=advanced)*

| Campo | Valor |
|---|---|
| `whenEntersReengagement` | tildá: `ghosting`, `lo-pienso`, `no-show` |
| `maxCycleLimit` | `30d` |
| `contactFrequency` | `semanal` |
| `maxAttemptsWithoutResponse` | `3` |
| `reengagementChannel` | tildá: `whatsapp` |
| `whatIsAllowedToSend` | tildá: `recordatorio`, `testimonio`, `educativo` |
| `whatIsNotAllowed` | tildá: `insistir`, `prometer`, `descuentos` |
| `route` | `ruta-a` |
| `routeAObjective` | Reagendar la valoración presencial perdida o aplazada, con foco en resolver la objeción que frenó el cierre original. |
| `whenConsideredRecovered` | tildá: `responde`, `reagendar` |
| `ifSaysAlreadyResolved` | `preguntar-futuro` |
| `humanResponsibleForNotification` | Dra. Laura Restrepo |

---

## Diapo 10 — Estilo, límites y ejemplos

| Campo | Valor |
|---|---|
| `restrictionsToRespect` | tildá: `no-prometer`, `no-diagnostico`, `no-antes-despues`, `no-descuentos` |
| `forbiddenPhrases` | tildá: `prometer-resultados`, `diagnostico`, `descuentos` |
| `sensitiveTopics` | tildá: `menores`, `salud` |
| `availableAssets` | tildá: `portafolio`, `testimonios`, `faq`, `sedes` |
| `officialLinks` | Instagram: https://instagram.com/clinicapetroestetica · Web: https://clinicapetro.com |
| `gptTrainingFileTypes` | dejá vacío |
| `gptTrainingFiles` | NO subir nada (saltar) |
| `mostCommonObjections` | tildá: `caro`, `averiguando`, `pensar` |
| `approvedObjectionResponses` | tildá: `precio-valor`, `pensarlo`, `envia-info` |
| `exampleGoodWayText` | Hola María, qué lindo que pensaste en nosotros. Para la zona del entrecejo, el botox dura entre 4 y 6 meses según cada persona. Te cuento que el Dr. Petro hace una valoración previa de 30 minutos para diseñar el plan a tu medida — eso garantiza un resultado natural. ¿Te parece si miramos una franja esta semana o la próxima? |
| `exampleGoodWayFiles` | NO subir nada |
| `exampleBadWayText` | El botox te va a quitar TODAS las arrugas seguro, no hay forma de que falle. Mirá, te puedo agendar ya mismo sin valoración y con un descuento especial si pagás hoy. ¡Aprovechá! |
| `exampleBadWayFiles` | NO subir nada |
| `scenariosToHandle` | dejá vacío *(opcional)* |
| `whenToEscalateToTeam` | tildá: `llamada`, `queja`, `caliente` |
| `approvedEscalationMessage` | Hola, te paso con la Dra. Laura Restrepo, asistente del Dr. Petro, para que coordine los próximos pasos contigo personalmente. Te escribe en los próximos 30 minutos. |
| `termsAccepted` | tildá la casilla |

---

## Después de enviar

1. La webapp te muestra `SuccessScreen`. Esperá ~18-27 seg (backend procesa).
2. Te llega a `recursos@idealidad.co` un email con:
   - Link al **Google Sheet** (16 pestañas) → este es el que necesitamos
   - Link a la **carpeta Drive**
3. Abrí el Sheet. La URL tiene la forma `https://docs.google.com/spreadsheets/d/AAAAAAAAA/edit`. **El `AAAAAAAAA` es el `spreadsheetId`**. Pasámelo.
4. **Importante para Día 2:** el service account del onboarding ya tiene permiso sobre la Shared Drive — el agente puede leer el sheet sin que vos compartas nada manual.
