// =============================================================================
// tools.js — Tool definitions + handlers for the agent's function calling.
// =============================================================================
// Cada tool tiene:
//   - schema: definición JSON Schema para OpenAI function calling
//   - handler: función async que recibe args + contexto, devuelve resultado
//
// Handlers actuales: MOCKEADOS. Cuando lleguen las credenciales reales (GHL
// API key + calendar_id del Dr. Petro) se enchufan en 1 línea cada uno.
// =============================================================================

import { randomUUID } from 'node:crypto';

// ─── Tool schemas (para OpenAI) ────────────────────────────────────────────
export const TOOL_SCHEMAS = [
  {
    type: 'function',
    function: {
      name: 'consultar_calendario_ghl',
      description:
        'Consulta los slots libres del calendario REAL de GHL para un rango de fechas. ' +
        'Usar SIEMPRE que el lead pregunte por disponibilidad concreta ("¿hay cupo el martes?", ' +
        '"¿cuándo me podrían atender?"). Nunca inventar slots — esta es la única fuente de verdad. ' +
        'Devuelve hasta 5 slots libres en formato ISO 8601.',
      parameters: {
        type: 'object',
        properties: {
          fecha_inicio: {
            type: 'string',
            description:
              'Fecha de inicio del rango a consultar, formato YYYY-MM-DD. Si el lead no especifica, ' +
              'usar "hoy". Si dice "esta semana" usar el lunes de esta semana.',
          },
          fecha_fin: {
            type: 'string',
            description:
              'Fecha final del rango, formato YYYY-MM-DD. Default: 7 días después de fecha_inicio.',
          },
        },
        required: ['fecha_inicio'],
      },
    },
  },

  {
    type: 'function',
    function: {
      name: 'escalar_a_humano',
      description:
        'Transfiere la conversación a un humano del equipo del cliente. Usar cuando: ' +
        'el lead pide hablar con persona real, está molesto/agresivo, hay un tema sensible ' +
        '(salud crítica, queja, fraude), o el lead pregunta algo crítico que no está en el KB. ' +
        'Una vez escalado, el agente NO sigue respondiendo — espera al humano.',
      parameters: {
        type: 'object',
        properties: {
          razon: {
            type: 'string',
            description:
              'Razón del handoff. Categorías permitidas: ' +
              '"lead_molesto" | "pide_humano" | "tema_sensible" | "queja" | "fuera_de_kb" | "fraude" | "otro".',
            enum: ['lead_molesto', 'pide_humano', 'tema_sensible', 'queja', 'fuera_de_kb', 'fraude', 'otro'],
          },
          resumen: {
            type: 'string',
            description:
              'Resumen de 1-2 frases de la situación para que el humano entienda al entrar. ' +
              'Incluir contexto crítico: qué pidió el lead, qué se le dijo, dónde quedó.',
          },
          urgencia: {
            type: 'string',
            enum: ['baja', 'media', 'alta', 'critica'],
            description: 'Default media. Usar "critica" SOLO si hay riesgo médico o legal.',
          },
        },
        required: ['razon', 'resumen'],
      },
    },
  },

  {
    type: 'function',
    function: {
      name: 'crear_cita',
      description:
        'Confirma y crea una cita en GHL para el lead. Llamar SOLO después de: ' +
        '(1) consultar_calendario_ghl confirmó disponibilidad real, ' +
        '(2) el lead aceptó explícitamente un slot, ' +
        '(3) tenemos al menos nombre y teléfono del lead. ' +
        'Si falta cualquiera de las 3, pedir lo que falte con `pedir_dato` antes de crear cita.',
      parameters: {
        type: 'object',
        properties: {
          slot_iso: {
            type: 'string',
            description: 'Slot confirmado por el lead, ISO 8601 con timezone (ej "2026-05-20T10:00:00-05:00").',
          },
          nombre_lead: { type: 'string', description: 'Nombre completo del lead.' },
          telefono_lead: { type: 'string', description: 'Teléfono con código de país (ej "+57 310...").' },
          servicio_external_id: {
            type: 'string',
            description:
              'ID del servicio que se va a agendar (ej "SRV_001"). Si es valoración previa al tratamiento, ' +
              'usar el SRV de valoración del catálogo.',
          },
          notas: {
            type: 'string',
            description: 'Notas opcionales para el equipo (ej "lead preguntó por botox entrecejo").',
          },
        },
        required: ['slot_iso', 'nombre_lead', 'telefono_lead', 'servicio_external_id'],
      },
    },
  },

  {
    type: 'function',
    function: {
      name: 'pedir_dato',
      description:
        'Solicita formalmente un dato faltante del lead (nombre, teléfono, ciudad, etc.). ' +
        'Esto NO genera mensaje al lead — el LLM debe seguir pidiendo el dato en la conversación. ' +
        'Esta tool es para que el sistema sepa qué dato falta y pueda renderizar un input ' +
        '(en el frontend) o cargar el campo correspondiente en GHL.',
      parameters: {
        type: 'object',
        properties: {
          que_dato: {
            type: 'string',
            enum: ['nombre', 'telefono', 'email', 'ciudad', 'fecha_preferida', 'servicio_interes', 'otro'],
            description: 'Tipo de dato que falta.',
          },
          contexto: {
            type: 'string',
            description: 'Por qué se necesita ese dato (1 frase).',
          },
        },
        required: ['que_dato'],
      },
    },
  },
];

// ─── Tool handlers ─────────────────────────────────────────────────────────
// Reciben { args, ctx } donde ctx tiene { pool, clientId, conversationId, contactId }
// y devuelven { ok, ...data } o { ok: false, error }

async function handleConsultarCalendario({ args }) {
  // MOCK: devuelve 3 slots fake. Cuando llegue GHL_API_KEY + PILOT_GHL_CALENDAR_ID,
  // se reemplaza el cuerpo con un fetch a GHL Calendar API.
  const today = new Date(args.fecha_inicio || new Date().toISOString().slice(0, 10));
  const slots = [];
  for (let i = 1; i <= 3; i++) {
    const d = new Date(today);
    d.setDate(d.getDate() + i);
    d.setHours(10 + i, 0, 0, 0);
    slots.push(d.toISOString());
  }
  return {
    ok: true,
    mock: true,
    slots,
    nota:
      'MOCK — cuando se enchufe GHL real, estos slots vendrán del calendario del Dr. Petro. ' +
      'Devuelve solo horarios reales libres.',
  };
}

async function handleEscalarAHumano({ args, ctx }) {
  // Persiste en audit_log + devuelve ticket_id.
  // Futuro: mandar email al equipo IDEA IA + asignar en GHL.
  const ticketId = randomUUID();
  await ctx.pool.query(
    `INSERT INTO audit_log (client_id, event_type, severity, payload)
     VALUES ($1, 'escalation_triggered', $2, $3)`,
    [
      ctx.clientId,
      args.urgencia === 'critica' ? 'error' : args.urgencia === 'alta' ? 'warn' : 'info',
      JSON.stringify({
        ticket_id: ticketId,
        razon: args.razon,
        resumen: args.resumen,
        urgencia: args.urgencia || 'media',
        contact_id: ctx.contactId,
        conversation_id: ctx.conversationId,
      }),
    ]
  );
  return {
    ok: true,
    ticket_id: ticketId,
    siguiente_paso:
      'El equipo va a contactar al lead en breve. Confirmá al lead que un humano ya está al tanto y va a responder.',
  };
}

async function handleCrearCita({ args }) {
  // MOCK: devuelve cita_id fake. Cuando llegue GHL_API_KEY, hacer POST a
  // /calendars/events de GHL.
  return {
    ok: true,
    mock: true,
    cita_id: 'CITA-' + randomUUID().slice(0, 8).toUpperCase(),
    slot_confirmado: args.slot_iso,
    nota:
      'MOCK — cita "registrada" en sistema, pero no en GHL real todavía. ' +
      'Cuando llegue GHL_API_KEY se crea de verdad en el calendario.',
  };
}

async function handlePedirDato({ args }) {
  // Devuelve la "petición" para que el frontend (o n8n) la renderice como input
  // del lead. En el flow real de GHL, esto se mapea a un campo del contacto.
  return {
    ok: true,
    request_data: args.que_dato,
    contexto: args.contexto || null,
  };
}

// ─── Registry público ──────────────────────────────────────────────────────
export const TOOL_HANDLERS = {
  consultar_calendario_ghl: handleConsultarCalendario,
  escalar_a_humano: handleEscalarAHumano,
  crear_cita: handleCrearCita,
  pedir_dato: handlePedirDato,
};

// Helper: ejecuta una tool por nombre con args + ctx, atrapa errores.
export async function executeTool(name, args, ctx) {
  const t0 = Date.now();
  const handler = TOOL_HANDLERS[name];
  if (!handler) {
    return {
      ok: false,
      error: `Tool desconocida: ${name}`,
      latency_ms: 0,
    };
  }
  try {
    const result = await handler({ args, ctx });
    return { ...result, latency_ms: Date.now() - t0 };
  } catch (e) {
    return { ok: false, error: e.message, latency_ms: Date.now() - t0 };
  }
}
