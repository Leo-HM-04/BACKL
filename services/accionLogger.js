// Helper centralizado para registrar acciones y notificar con sistema mejorado
const notificacionesServiceMejorado = require('./notificacionesServiceMejorado');
const usuarioModel = require('../models/usuario.model');

/**
 * Registra una acción relevante y notifica usando el sistema mejorado
 * @param {Object} params
 * @param {Object} params.req - El request de Express (req)
 * @param {string} params.accion - Acción realizada (ej: 'creó', 'eliminó', 'subió', 'actualizó', 'aprobó', 'rechazó', 'pagó')
 * @param {string} params.entidad - Entidad afectada (ej: 'usuario', 'solicitud', 'comprobante', 'viático', 'pago recurrente')
 * @param {string|number} [params.entidadId] - ID de la entidad afectada
 * @param {string} [params.mensajeExtra] - Mensaje adicional personalizado
 * @param {Object} [params.detalles] - Detalles específicos de la acción (monto, concepto, etc.)
 * @param {string} [params.destinatarioRol] - Rol específico del destinatario (por defecto 'admin_general')
 * @param {number} [params.destinatarioId] - ID específico del destinatario
 */
async function registrarAccion({ 
  req, 
  accion, 
  entidad, 
  entidadId = null, 
  mensajeExtra = '', 
  detalles = {},
  destinatarioRol = 'admin_general',
  destinatarioId = null
}) {
  try {
    // Usuario que realiza la acción
    const usuario = req.user || {};
    const id_usuario_emisor = usuario.id_usuario;
    
    if (!id_usuario_emisor) {
      console.error('[AccionLogger] No se encontró usuario emisor en req.user');
      return;
    }

    // Mapear acciones a tipos de notificación específicos
    const mapeoAcciones = {
      // Solicitudes
      'creó_solicitud': notificacionesServiceMejorado.TIPOS_NOTIFICACION.SOLICITUD_CREADA,
      'aprobó_solicitud': notificacionesServiceMejorado.TIPOS_NOTIFICACION.SOLICITUD_APROBADA,
      'rechazó_solicitud': notificacionesServiceMejorado.TIPOS_NOTIFICACION.SOLICITUD_RECHAZADA,
      'pagó_solicitud': notificacionesServiceMejorado.TIPOS_NOTIFICACION.SOLICITUD_PAGADA,
      'actualizó_solicitud': notificacionesServiceMejorado.TIPOS_NOTIFICACION.SOLICITUD_ACTUALIZADA,
      'eliminó_solicitud': notificacionesServiceMejorado.TIPOS_NOTIFICACION.SOLICITUD_ELIMINADA,
      
      // Viáticos
      'creó_viatico': notificacionesServiceMejorado.TIPOS_NOTIFICACION.VIATICO_CREADO,
      'aprobó_viatico': notificacionesServiceMejorado.TIPOS_NOTIFICACION.VIATICO_APROBADO,
      'rechazó_viatico': notificacionesServiceMejorado.TIPOS_NOTIFICACION.VIATICO_RECHAZADO,
      'pagó_viatico': notificacionesServiceMejorado.TIPOS_NOTIFICACION.VIATICO_PAGADO,
      
      // Recurrentes
      'creó_recurrente': notificacionesServiceMejorado.TIPOS_NOTIFICACION.RECURRENTE_CREADA,
      'aprobó_recurrente': notificacionesServiceMejorado.TIPOS_NOTIFICACION.RECURRENTE_APROBADA,
      'rechazó_recurrente': notificacionesServiceMejorado.TIPOS_NOTIFICACION.RECURRENTE_RECHAZADA,
      
      // Comprobantes
      'subió_comprobante': notificacionesServiceMejorado.TIPOS_NOTIFICACION.COMPROBANTE_SUBIDO,
      'aprobó_comprobante': notificacionesServiceMejorado.TIPOS_NOTIFICACION.COMPROBANTE_APROBADO,
      'rechazó_comprobante': notificacionesServiceMejorado.TIPOS_NOTIFICACION.COMPROBANTE_RECHAZADO,
      
      // Usuarios
      'creó_usuario': notificacionesServiceMejorado.TIPOS_NOTIFICACION.USUARIO_CREADO,
      'actualizó_usuario': notificacionesServiceMejorado.TIPOS_NOTIFICACION.USUARIO_ACTUALIZADO,
      'eliminó_usuario': notificacionesServiceMejorado.TIPOS_NOTIFICACION.USUARIO_ELIMINADO,
      
      // Acciones en lote
      'aprobó_lote': notificacionesServiceMejorado.TIPOS_NOTIFICACION.LOTE_APROBADO,
      'rechazó_lote': notificacionesServiceMejorado.TIPOS_NOTIFICACION.LOTE_RECHAZADO,
      'pagó_lote': notificacionesServiceMejorado.TIPOS_NOTIFICACION.LOTE_PAGADO
    };

    // Determinar tipo de notificación
    const tipoKey = `${accion}_${entidad}`.toLowerCase();
    const tipo = mapeoAcciones[tipoKey] || 'sistema_accion';

    // Crear notificación mejorada
    await notificacionesServiceMejorado.crearNotificacionMejorada({
      tipo,
      id_usuario_emisor,
      id_usuario_destinatario: destinatarioId,
      destinatarios_rol: destinatarioId ? null : destinatarioRol,
      entidad,
      entidad_id: entidadId,
      detalles: {
        ...detalles,
        accion,
        mensaje_extra: mensajeExtra
      },
      enviarWebSocket: true,
      enviarCorreo: tipo.includes('rechaz') || tipo.includes('pago') || tipo.includes('critica'),
      contexto: {
        ip: req.ip || req.connection?.remoteAddress,
        userAgent: req.get('User-Agent'),
        timestamp: new Date()
      }
    });

    console.log('[AccionLogger] Acción registrada:', { 
      accion, 
      entidad, 
      entidadId, 
      usuario: usuario.nombre, 
      tipo 
    });

  } catch (error) {
    console.error('[AccionLogger] Error registrando acción:', error);
    
    // Fallback al sistema anterior en caso de error
    try {
      const notificacionesService = require('./notificacionesService');
      const admin = await usuarioModel.getUsuarioByRol('admin_general');
      if (admin) {
        const nombreUsuario = req.user?.nombre || 'Usuario desconocido';
        const rolUsuario = req.user?.rol || 'Sin rol';
        const mensaje = `🔔 ${nombreUsuario} (${rolUsuario}) ${accion} ${entidad}${entidadId ? ` #${entidadId}` : ''}${mensajeExtra ? `. ${mensajeExtra}` : ''}`;
        
        await notificacionesService.crearNotificacion({
          id_usuario: admin.id_usuario,
          mensaje,
          enviarWebSocket: true,
          enviarCorreo: false
        });
      }
    } catch (fallbackError) {
      console.error('[AccionLogger] Error en fallback:', fallbackError);
    }
  }
}

/**
 * Registrar acción específica para solicitudes
 */
async function registrarAccionSolicitud({ req, accion, solicitudId, detalles = {} }) {
  return registrarAccion({
    req,
    accion: `${accion}_solicitud`,
    entidad: 'solicitud',
    entidadId: solicitudId,
    detalles,
    destinatarioRol: accion === 'creó' ? 'aprobador' : 'admin_general'
  });
}

/**
 * Registrar acción específica para viáticos
 */
async function registrarAccionViatico({ req, accion, viaticoId, detalles = {} }) {
  return registrarAccion({
    req,
    accion: `${accion}_viatico`,
    entidad: 'viatico',
    entidadId: viaticoId,
    detalles,
    destinatarioRol: accion === 'creó' ? 'aprobador' : 'admin_general'
  });
}

/**
 * Registrar acción específica para recurrentes
 */
async function registrarAccionRecurrente({ req, accion, recurrenteId, detalles = {} }) {
  return registrarAccion({
    req,
    accion: `${accion}_recurrente`,
    entidad: 'recurrente',
    entidadId: recurrenteId,
    detalles,
    destinatarioRol: accion === 'creó' ? 'aprobador' : 'admin_general'
  });
}

/**
 * Registrar acción en lote
 */
async function registrarAccionLote({ req, accion, entidad, ids = [], detalles = {} }) {
  return registrarAccion({
    req,
    accion: `${accion}_lote`,
    entidad: entidad,
    entidadId: ids.join(','),
    detalles: {
      ...detalles,
      cantidad: ids.length,
      ids_afectados: ids
    },
    destinatarioRol: 'admin_general'
  });
}

module.exports = { 
  registrarAccion,
  registrarAccionSolicitud,
  registrarAccionViatico,
  registrarAccionRecurrente,
  registrarAccionLote
};
