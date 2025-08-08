/* ──────────────────────────────────────────────────────────────
   Servicio de Notificaciones Mejorado
   Sistema de notificaciones específicas y detalladas por rol
   ────────────────────────────────────────────────────────────── */

const pool = require("../db/connection");
const correoService = require("./correoService");
const ws = require("../ws");

/**
 * Tipos de notificación específicos
 */
const TIPOS_NOTIFICACION = {
  // Solicitudes
  SOLICITUD_CREADA: 'solicitud_creada',
  SOLICITUD_APROBADA: 'solicitud_aprobada', 
  SOLICITUD_RECHAZADA: 'solicitud_rechazada',
  SOLICITUD_PAGADA: 'solicitud_pagada',
  SOLICITUD_ACTUALIZADA: 'solicitud_actualizada',
  SOLICITUD_ELIMINADA: 'solicitud_eliminada',
  
  // Viáticos
  VIATICO_CREADO: 'viatico_creado',
  VIATICO_APROBADO: 'viatico_aprobado',
  VIATICO_RECHAZADO: 'viatico_rechazado',
  VIATICO_PAGADO: 'viatico_pagado',
  
  // Recurrentes
  RECURRENTE_CREADA: 'recurrente_creada',
  RECURRENTE_APROBADA: 'recurrente_aprobada',
  RECURRENTE_RECHAZADA: 'recurrente_rechazada',
  RECURRENTE_EJECUTADA: 'recurrente_ejecutada',
  
  // Comprobantes
  COMPROBANTE_SUBIDO: 'comprobante_subido',
  COMPROBANTE_APROBADO: 'comprobante_aprobado',
  COMPROBANTE_RECHAZADO: 'comprobante_rechazado',
  
  // Usuarios
  USUARIO_CREADO: 'usuario_creado',
  USUARIO_ACTUALIZADO: 'usuario_actualizado',
  USUARIO_ELIMINADO: 'usuario_eliminado',
  USUARIO_BIENVENIDA: 'usuario_bienvenida',
  
  // Sistema
  SISTEMA_MANTENIMIENTO: 'sistema_mantenimiento',
  SISTEMA_ALERTA: 'sistema_alerta',
  
  // Acciones en lote
  LOTE_APROBADO: 'lote_aprobado',
  LOTE_RECHAZADO: 'lote_rechazado',
  LOTE_PAGADO: 'lote_pagado'
};

/**
 * Niveles de prioridad para las notificaciones
 */
const PRIORIDADES = {
  BAJA: 'baja',
  NORMAL: 'normal', 
  ALTA: 'alta',
  CRITICA: 'critica'
};

/**
 * Obtener información completa del usuario
 */
async function obtenerInfoUsuario(id_usuario) {
  try {
    const [rows] = await pool.query(`
      SELECT u.id_usuario, u.nombre, u.email, u.rol, d.nombre_departamento
      FROM usuarios u 
      LEFT JOIN departamentos d ON u.departamento_id = d.id_departamento
      WHERE u.id_usuario = ?
    `, [id_usuario]);
    
    return rows[0] || null;
  } catch (error) {
    console.error('[NotificacionesMejorado] Error obteniendo info usuario:', error);
    return null;
  }
}

/**
 * Obtener usuarios por rol
 */
async function obtenerUsuariosPorRol(rol) {
  try {
    const [rows] = await pool.query(`
      SELECT u.id_usuario, u.nombre, u.email, u.rol, d.nombre_departamento
      FROM usuarios u 
      LEFT JOIN departamentos d ON u.departamento_id = d.id_departamento
      WHERE u.rol = ? AND u.activo = 1
    `, [rol]);
    
    return rows;
  } catch (error) {
    console.error('[NotificacionesMejorado] Error obteniendo usuarios por rol:', error);
    return [];
  }
}

/**
 * Crear mensaje personalizado según tipo de notificación y destinatario
 */
function crearMensajePersonalizado({
  tipo,
  usuarioEmisor,
  usuarioDestinatario, 
  entidad,
  detalles = {},
  contexto = {}
}) {
  const emisor = usuarioEmisor?.nombre || 'Usuario desconocido';
  const rolEmisor = usuarioEmisor?.rol || '';
  const rolDestinatario = usuarioDestinatario?.rol || '';
  const departamentoEmisor = usuarioEmisor?.nombre_departamento || 'Sin departamento';
  
  // Emojis por tipo de acción
  const emojis = {
    [TIPOS_NOTIFICACION.SOLICITUD_CREADA]: '📝',
    [TIPOS_NOTIFICACION.SOLICITUD_APROBADA]: '✅', 
    [TIPOS_NOTIFICACION.SOLICITUD_RECHAZADA]: '❌',
    [TIPOS_NOTIFICACION.SOLICITUD_PAGADA]: '💸',
    [TIPOS_NOTIFICACION.VIATICO_CREADO]: '🧳',
    [TIPOS_NOTIFICACION.VIATICO_APROBADO]: '✈️',
    [TIPOS_NOTIFICACION.VIATICO_RECHAZADO]: '⛔',
    [TIPOS_NOTIFICACION.COMPROBANTE_SUBIDO]: '📎',
    [TIPOS_NOTIFICACION.USUARIO_CREADO]: '👤',
    [TIPOS_NOTIFICACION.USUARIO_BIENVENIDA]: '🎉',
    [TIPOS_NOTIFICACION.RECURRENTE_CREADA]: '🔄',
    [TIPOS_NOTIFICACION.RECURRENTE_APROBADA]: '🔄✅',
    [TIPOS_NOTIFICACION.LOTE_APROBADO]: '✅📋',
    [TIPOS_NOTIFICACION.LOTE_RECHAZADO]: '❌📋'
  };
  
  const emoji = emojis[tipo] || '🔔';
  
  // Crear mensajes específicos por tipo y rol del destinatario
  switch (tipo) {
    case TIPOS_NOTIFICACION.SOLICITUD_CREADA:
      if (rolDestinatario === 'admin_general') {
        return `${emoji} <strong>${emisor}</strong> (${rolEmisor === 'solicitante' ? 'Solicitante' : 'Administrador'}) de <strong>${departamentoEmisor}</strong> creó una nueva solicitud por <strong>$${detalles.monto?.toLocaleString()}</strong><br>📋 <strong>Concepto:</strong> ${detalles.concepto}<br>🏢 <strong>Empresa:</strong> ${detalles.empresa_a_pagar || 'No especificada'}<br>📅 <strong>Límite de pago:</strong> ${detalles.fecha_limite_pago || 'Sin límite'}`;
      } else if (rolDestinatario === 'aprobador') {
        return `${emoji} Nueva solicitud para revisar de <strong>${emisor}</strong> (${departamentoEmisor})<br>💰 <strong>Monto:</strong> $${detalles.monto?.toLocaleString()}<br>📋 <strong>Concepto:</strong> ${detalles.concepto}<br>⏰ <strong>Requiere aprobación</strong>`;
      } else {
        return `${emoji} Tu solicitud por <strong>$${detalles.monto?.toLocaleString()}</strong> fue registrada exitosamente<br>📋 <strong>Concepto:</strong> ${detalles.concepto}<br>⏳ <strong>Estado:</strong> Pendiente de aprobación`;
      }
      
    case TIPOS_NOTIFICACION.SOLICITUD_APROBADA:
      if (rolDestinatario === 'solicitante') {
        return `${emoji} ¡Tu solicitud por <strong>$${detalles.monto?.toLocaleString()}</strong> fue <strong>APROBADA</strong> por <strong>${emisor}</strong>!<br>📋 <strong>Concepto:</strong> ${detalles.concepto}<br>💳 <strong>Próximo paso:</strong> Procesamiento de pago`;
      } else if (rolDestinatario === 'pagador_banca') {
        return `${emoji} Nueva solicitud <strong>AUTORIZADA</strong> para procesar pago<br>👤 <strong>Solicitante:</strong> ${detalles.solicitante_nombre} (${detalles.solicitante_departamento})<br>💰 <strong>Monto:</strong> $${detalles.monto?.toLocaleString()}<br>📋 <strong>Concepto:</strong> ${detalles.concepto}<br>✅ <strong>Aprobada por:</strong> ${emisor}`;
      } else if (rolDestinatario === 'admin_general') {
        return `${emoji} <strong>${emisor}</strong> aprobó la solicitud de <strong>${detalles.solicitante_nombre}</strong><br>💰 <strong>Monto:</strong> $${detalles.monto?.toLocaleString()}<br>🏢 <strong>Departamento:</strong> ${detalles.solicitante_departamento}`;
      } else {
        return `${emoji} Aprobaste la solicitud de <strong>${detalles.solicitante_nombre}</strong> por <strong>$${detalles.monto?.toLocaleString()}</strong>`;
      }
      
    case TIPOS_NOTIFICACION.SOLICITUD_RECHAZADA:
      if (rolDestinatario === 'solicitante') {
        const razon = detalles.comentario_aprobador ? `<br>📝 <strong>Motivo:</strong> ${detalles.comentario_aprobador}` : '';
        return `${emoji} Tu solicitud por <strong>$${detalles.monto?.toLocaleString()}</strong> fue <strong>RECHAZADA</strong> por <strong>${emisor}</strong>${razon}<br>📋 <strong>Concepto:</strong> ${detalles.concepto}<br>💡 <strong>Puedes crear una nueva solicitud corrigiendo los aspectos indicados</strong>`;
      } else if (rolDestinatario === 'admin_general') {
        return `${emoji} <strong>${emisor}</strong> rechazó la solicitud de <strong>${detalles.solicitante_nombre}</strong><br>💰 <strong>Monto:</strong> $${detalles.monto?.toLocaleString()}<br>📝 <strong>Motivo:</strong> ${detalles.comentario_aprobador || 'Sin especificar'}`;
      } else {
        return `${emoji} Rechazaste la solicitud de <strong>${detalles.solicitante_nombre}</strong> por <strong>$${detalles.monto?.toLocaleString()}</strong>`;
      }
      
    case TIPOS_NOTIFICACION.SOLICITUD_PAGADA:
      if (rolDestinatario === 'solicitante') {
        return `${emoji} ¡Tu solicitud por <strong>$${detalles.monto?.toLocaleString()}</strong> ha sido <strong>PAGADA</strong>!<br>📋 <strong>Concepto:</strong> ${detalles.concepto}<br>💳 <strong>Cuenta destino:</strong> ${detalles.cuenta_destino}<br>🏦 <strong>Procesado por:</strong> ${emisor}<br>📅 <strong>Fecha de pago:</strong> ${new Date().toLocaleDateString('es-MX')}`;
      } else if (rolDestinatario === 'aprobador') {
        return `${emoji} La solicitud que aprobaste de <strong>${detalles.solicitante_nombre}</strong> ha sido pagada<br>💰 <strong>Monto:</strong> $${detalles.monto?.toLocaleString()}<br>🏦 <strong>Procesado por:</strong> ${emisor}`;
      } else if (rolDestinatario === 'admin_general') {
        return `${emoji} <strong>${emisor}</strong> procesó el pago de la solicitud de <strong>${detalles.solicitante_nombre}</strong><br>💰 <strong>Monto:</strong> $${detalles.monto?.toLocaleString()}<br>🏢 <strong>Departamento:</strong> ${detalles.solicitante_departamento}`;
      } else {
        return `${emoji} Procesaste el pago de <strong>${detalles.solicitante_nombre}</strong> por <strong>$${detalles.monto?.toLocaleString()}</strong>`;
      }
      
    case TIPOS_NOTIFICACION.VIATICO_CREADO:
      if (rolDestinatario === 'admin_general') {
        return `${emoji} <strong>${emisor}</strong> (${departamentoEmisor}) creó una nueva solicitud de viático<br>💰 <strong>Monto:</strong> $${detalles.monto?.toLocaleString()}<br>📋 <strong>Concepto:</strong> ${detalles.concepto}<br>🎯 <strong>Destino:</strong> ${detalles.destino || 'No especificado'}`;
      } else if (rolDestinatario === 'aprobador') {
        return `${emoji} Nueva solicitud de viático para revisar de <strong>${emisor}</strong><br>💰 <strong>Monto:</strong> $${detalles.monto?.toLocaleString()}<br>🎯 <strong>Destino:</strong> ${detalles.destino || 'No especificado'}<br>⏰ <strong>Requiere aprobación</strong>`;
      } else {
        return `${emoji} Tu solicitud de viático por <strong>$${detalles.monto?.toLocaleString()}</strong> fue registrada<br>🎯 <strong>Destino:</strong> ${detalles.destino || 'No especificado'}`;
      }
      
    case TIPOS_NOTIFICACION.COMPROBANTE_SUBIDO:
      if (rolDestinatario === 'admin_general') {
        return `${emoji} <strong>${emisor}</strong> subió un comprobante<br>📄 <strong>Tipo:</strong> ${detalles.tipo_comprobante}<br>🔗 <strong>Relacionado con:</strong> ${detalles.entidad_relacionada}<br>📅 <strong>Fecha:</strong> ${new Date().toLocaleDateString('es-MX')}`;
      } else if (rolDestinatario === 'aprobador') {
        return `${emoji} Se subió un comprobante para revisar<br>👤 <strong>Subido por:</strong> ${emisor}<br>📄 <strong>Tipo:</strong> ${detalles.tipo_comprobante}`;
      } else {
        return `${emoji} Tu comprobante fue subido correctamente<br>📄 <strong>Tipo:</strong> ${detalles.tipo_comprobante}`;
      }
      
    case TIPOS_NOTIFICACION.USUARIO_CREADO:
      if (rolDestinatario === 'admin_general') {
        return `${emoji} Se creó un nuevo usuario en el sistema<br>👤 <strong>Nombre:</strong> ${detalles.usuario_nombre}<br>✉️ <strong>Email:</strong> ${detalles.usuario_email}<br>🎭 <strong>Rol:</strong> ${detalles.usuario_rol}<br>🏢 <strong>Departamento:</strong> ${detalles.usuario_departamento || 'Sin asignar'}<br>👨‍💼 <strong>Creado por:</strong> ${emisor}`;
      } else {
        return `${emoji} ¡Bienvenido/a <strong>${detalles.usuario_nombre}</strong>! Tu cuenta ha sido creada exitosamente<br>🎭 <strong>Rol:</strong> ${detalles.usuario_rol}<br>🏢 <strong>Departamento:</strong> ${detalles.usuario_departamento || 'Sin asignar'}<br>🚀 <strong>Ya puedes comenzar a usar la plataforma</strong>`;
      }
      
    case TIPOS_NOTIFICACION.LOTE_APROBADO:
      if (rolDestinatario === 'admin_general') {
        return `${emoji} <strong>${emisor}</strong> aprobó <strong>${detalles.cantidad}</strong> ${detalles.tipo_entidad}s en lote<br>💰 <strong>Monto total:</strong> $${detalles.monto_total?.toLocaleString()}<br>📋 <strong>Operación:</strong> Aprobación masiva`;
      } else if (rolDestinatario === 'pagador_banca') {
        return `${emoji} <strong>${detalles.cantidad}</strong> ${detalles.tipo_entidad}s fueron aprobadas para pago<br>💰 <strong>Monto total:</strong> $${detalles.monto_total?.toLocaleString()}<br>✅ <strong>Aprobadas por:</strong> ${emisor}<br>⏰ <strong>Listas para procesar</strong>`;
      } else {
        return `${emoji} Aprobaste <strong>${detalles.cantidad}</strong> ${detalles.tipo_entidad}s en lote<br>💰 <strong>Monto total:</strong> $${detalles.monto_total?.toLocaleString()}`;
      }
      
    case TIPOS_NOTIFICACION.LOTE_RECHAZADO:
      if (rolDestinatario === 'admin_general') {
        return `${emoji} <strong>${emisor}</strong> rechazó <strong>${detalles.cantidad}</strong> ${detalles.tipo_entidad}s en lote<br>📝 <strong>Motivo:</strong> ${detalles.comentario || 'Sin especificar'}<br>📋 <strong>Operación:</strong> Rechazo masivo`;
      } else {
        return `${emoji} Rechazaste <strong>${detalles.cantidad}</strong> ${detalles.tipo_entidad}s en lote<br>📝 <strong>Motivo:</strong> ${detalles.comentario || 'Sin especificar'}`;
      }
      
    case TIPOS_NOTIFICACION.RECURRENTE_CREADA:
      if (rolDestinatario === 'admin_general') {
        return `${emoji} <strong>${emisor}</strong> creó una nueva plantilla de pago recurrente<br>💰 <strong>Monto:</strong> $${detalles.monto?.toLocaleString()}<br>📋 <strong>Concepto:</strong> ${detalles.concepto}<br>🔄 <strong>Frecuencia:</strong> ${detalles.frecuencia}<br>📅 <strong>Próxima ejecución:</strong> ${detalles.siguiente_fecha}`;
      } else if (rolDestinatario === 'aprobador') {
        return `${emoji} Nueva plantilla recurrente para revisar de <strong>${emisor}</strong><br>💰 <strong>Monto:</strong> $${detalles.monto?.toLocaleString()}<br>🔄 <strong>Frecuencia:</strong> ${detalles.frecuencia}<br>⏰ <strong>Requiere aprobación</strong>`;
      } else {
        return `${emoji} Tu plantilla de pago recurrente fue creada<br>💰 <strong>Monto:</strong> $${detalles.monto?.toLocaleString()}<br>🔄 <strong>Frecuencia:</strong> ${detalles.frecuencia}`;
      }
      
    default:
      return `${emoji} <strong>${emisor}</strong> realizó una acción en el sistema<br>📋 <strong>Tipo:</strong> ${tipo}<br>📅 <strong>Fecha:</strong> ${new Date().toLocaleDateString('es-MX')}`;
  }
}

/**
 * Determinar prioridad según tipo de notificación
 */
function determinarPrioridad(tipo) {
  const prioridadesMap = {
    [TIPOS_NOTIFICACION.SOLICITUD_RECHAZADA]: PRIORIDADES.ALTA,
    [TIPOS_NOTIFICACION.SOLICITUD_PAGADA]: PRIORIDADES.ALTA,
    [TIPOS_NOTIFICACION.VIATICO_RECHAZADO]: PRIORIDADES.ALTA,
    [TIPOS_NOTIFICACION.SISTEMA_ALERTA]: PRIORIDADES.CRITICA,
    [TIPOS_NOTIFICACION.SOLICITUD_CREADA]: PRIORIDADES.NORMAL,
    [TIPOS_NOTIFICACION.SOLICITUD_APROBADA]: PRIORIDADES.NORMAL,
    [TIPOS_NOTIFICACION.VIATICO_CREADO]: PRIORIDADES.NORMAL,
    [TIPOS_NOTIFICACION.VIATICO_APROBADO]: PRIORIDADES.NORMAL,
    [TIPOS_NOTIFICACION.COMPROBANTE_SUBIDO]: PRIORIDADES.NORMAL,
    [TIPOS_NOTIFICACION.USUARIO_BIENVENIDA]: PRIORIDADES.BAJA,
    [TIPOS_NOTIFICACION.USUARIO_CREADO]: PRIORIDADES.BAJA
  };
  
  return prioridadesMap[tipo] || PRIORIDADES.NORMAL;
}

/**
 * Crear notificación mejorada con información detallada
 */
async function crearNotificacionMejorada({
  tipo,
  id_usuario_emisor,
  id_usuario_destinatario = null,
  destinatarios_rol = null, // 'admin_general', 'aprobador', etc.
  entidad,
  entidad_id = null,
  detalles = {},
  enviarWebSocket = true,
  enviarCorreo = false,
  contexto = {}
}) {
  try {
    console.log('[NotificacionesMejorado] Creando notificación:', { tipo, id_usuario_emisor, destinatarios_rol, entidad });
    
    // Obtener información del usuario emisor
    const usuarioEmisor = await obtenerInfoUsuario(id_usuario_emisor);
    if (!usuarioEmisor) {
      console.error('[NotificacionesMejorado] Usuario emisor no encontrado:', id_usuario_emisor);
      return;
    }
    
    let destinatarios = [];
    
    // Determinar destinatarios
    if (id_usuario_destinatario) {
      const destinatario = await obtenerInfoUsuario(id_usuario_destinatario);
      if (destinatario) {
        destinatarios = [destinatario];
      }
    } else if (destinatarios_rol) {
      destinatarios = await obtenerUsuariosPorRol(destinatarios_rol);
    }
    
    if (destinatarios.length === 0) {
      console.error('[NotificacionesMejorado] No se encontraron destinatarios');
      return;
    }
    
    const prioridad = determinarPrioridad(tipo);
    
    // Crear notificación para cada destinatario
    for (const destinatario of destinatarios) {
      // Crear mensaje personalizado
      const mensaje = crearMensajePersonalizado({
        tipo,
        usuarioEmisor,
        usuarioDestinatario: destinatario,
        entidad,
        detalles,
        contexto
      });
      
      // Insertar en base de datos con campos adicionales
      const [result] = await pool.query(`
        INSERT INTO notificaciones (
          id_usuario, 
          mensaje, 
          tipo, 
          prioridad, 
          entidad, 
          entidad_id, 
          id_usuario_emisor,
          leida, 
          fecha_creacion
        ) VALUES (?, ?, ?, ?, ?, ?, ?, 0, NOW())
      `, [
        destinatario.id_usuario,
        mensaje,
        tipo,
        prioridad,
        entidad,
        entidad_id,
        id_usuario_emisor
      ]);
      
      console.log('[NotificacionesMejorado] Notificación creada para:', destinatario.nombre, 'ID:', result.insertId);
      
      // Enviar por WebSocket si se solicita
      if (enviarWebSocket && ws && typeof ws.enviarNotificacion === 'function') {
        ws.enviarNotificacion(destinatario.id_usuario, {
          id: result.insertId,
          mensaje,
          tipo,
          prioridad,
          emisor: usuarioEmisor.nombre,
          fecha: new Date()
        });
      }
      
      // Enviar por correo si se solicita y es prioridad alta o crítica
      if (enviarCorreo || prioridad === PRIORIDADES.ALTA || prioridad === PRIORIDADES.CRITICA) {
        try {
          await correoService.enviarCorreo({
            para: destinatario.email,
            asunto: `Bechapra - Notificación ${prioridad === PRIORIDADES.CRITICA ? 'Urgente' : ''}`,
            nombre: destinatario.nombre,
            link: 'https://bechapra.com',
            mensaje: mensaje.replace(/<br>/g, '\n').replace(/<[^>]*>/g, '') // Remover HTML para email
          });
        } catch (err) {
          console.error('[NotificacionesMejorado] Error enviando correo:', err);
        }
      }
    }
    
  } catch (error) {
    console.error('[NotificacionesMejorado] Error creando notificación:', error);
  }
}

/**
 * Función de compatibilidad con el sistema anterior
 */
async function crearNotificacion({
  id_usuario,
  mensaje,
  enviarWebSocket = false,
  enviarCorreo = false,
  correo = null
}) {
  // Usar el sistema anterior para mantener compatibilidad
  const notificacionesService = require('./notificacionesService');
  return await notificacionesService.crearNotificacion({
    id_usuario,
    mensaje,
    enviarWebSocket,
    enviarCorreo,
    correo
  });
}

/**
 * Obtener notificaciones mejoradas para un usuario
 */
async function obtenerNotificacionesMejoradas(id_usuario, limite = 50) {
  try {
    const [rows] = await pool.query(`
      SELECT 
        n.id_notificacion,
        n.mensaje,
        n.tipo,
        n.prioridad,
        n.entidad,
        n.entidad_id,
        n.leida,
        n.fecha_creacion,
        u_emisor.nombre as emisor_nombre,
        u_emisor.rol as emisor_rol
      FROM notificaciones n
      LEFT JOIN usuarios u_emisor ON n.id_usuario_emisor = u_emisor.id_usuario
      WHERE n.id_usuario = ?
      ORDER BY 
        CASE n.prioridad 
          WHEN 'critica' THEN 1
          WHEN 'alta' THEN 2  
          WHEN 'normal' THEN 3
          WHEN 'baja' THEN 4
          ELSE 5
        END ASC,
        n.leida ASC,
        n.fecha_creacion DESC
      LIMIT ?
    `, [id_usuario, limite]);
    
    return rows.map(row => ({
      id: row.id_notificacion,
      mensaje: row.mensaje,
      tipo: row.tipo || 'info',
      prioridad: row.prioridad || 'normal',
      entidad: row.entidad,
      entidad_id: row.entidad_id,
      leida: !!row.leida,
      fecha: row.fecha_creacion,
      emisor: {
        nombre: row.emisor_nombre,
        rol: row.emisor_rol
      }
    }));
  } catch (error) {
    console.error('[NotificacionesMejorado] Error obteniendo notificaciones:', error);
    return [];
  }
}

module.exports = {
  TIPOS_NOTIFICACION,
  PRIORIDADES,
  crearNotificacionMejorada,
  crearNotificacion, // Compatibilidad hacia atrás
  obtenerNotificacionesMejoradas,
  marcarComoLeida: require('./notificacionesService').marcarComoLeida
};
