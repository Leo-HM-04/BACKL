/* ──────────────────────────────────────────────────────────────
   Controlador de Solicitudes - Funciones Mejoradas 
   Ejemplos de cómo implementar notificaciones más específicas
   ────────────────────────────────────────────────────────────── */

const SolicitudModel = require("../models/solicitud.model");
const NotificacionServiceMejorado = require("../services/notificacionesServiceMejorado");
const pool = require("../db/connection");
const { registrarAccionSolicitud } = require('../services/accionLogger');

/**
 * Función mejorada para aprobar solicitud con notificaciones específicas
 */
async function aprobarSolicitudMejorada(req, res) {
  try {
    const { id } = req.params;
    const { comentario_aprobador = '' } = req.body;
    const { id_usuario: id_aprobador, nombre: nombre_aprobador } = req.user;

    // Actualizar estado en base de datos
    const filas = await SolicitudModel.actualizarEstado(
      id,
      'autorizada',
      comentario_aprobador,
      id_aprobador
    );

    if (filas === 0) {
      return res.status(404).json({ error: "Solicitud no encontrada o ya procesada." });
    }

    // Obtener datos completos de la solicitud
    const [solicitudData] = await pool.query(`
      SELECT 
        s.*,
        u.nombre as solicitante_nombre,
        u.email as solicitante_email,
        d.nombre_departamento as departamento_nombre
      FROM solicitudes_pago s
      JOIN usuarios u ON u.id_usuario = s.id_usuario
      LEFT JOIN departamentos d ON d.id_departamento = s.departamento_id
      WHERE s.id_solicitud = ?
    `, [id]);

    const solicitud = solicitudData[0];
    if (!solicitud) {
      return res.status(404).json({ error: "Datos de solicitud no encontrados." });
    }

    // Preparar detalles para las notificaciones
    const detallesSolicitud = {
      monto: parseFloat(solicitud.monto),
      concepto: solicitud.concepto,
      departamento: solicitud.departamento,
      empresa_a_pagar: solicitud.empresa_a_pagar || 'No especificada',
      cuenta_destino: solicitud.cuenta_destino,
      tipo_pago: solicitud.tipo_pago,
      solicitante_nombre: solicitud.solicitante_nombre,
      solicitante_departamento: solicitud.departamento_nombre || solicitud.departamento,
      comentario_aprobador: comentario_aprobador || 'Sin comentarios',
      aprobador_nombre: nombre_aprobador,
      fecha_aprobacion: new Date().toLocaleDateString('es-MX')
    };

    // 1. Notificar al solicitante
    await NotificacionServiceMejorado.crearNotificacionMejorada({
      tipo: NotificacionServiceMejorado.TIPOS_NOTIFICACION.SOLICITUD_APROBADA,
      id_usuario_emisor: id_aprobador,
      id_usuario_destinatario: solicitud.id_usuario,
      entidad: 'solicitud',
      entidad_id: id,
      detalles: detallesSolicitud,
      enviarWebSocket: true,
      enviarCorreo: true
    });

    // 2. Notificar a todos los pagadores
    await NotificacionServiceMejorado.crearNotificacionMejorada({
      tipo: NotificacionServiceMejorado.TIPOS_NOTIFICACION.SOLICITUD_APROBADA,
      id_usuario_emisor: id_aprobador,
      destinatarios_rol: 'pagador_banca',
      entidad: 'solicitud',
      entidad_id: id,
      detalles: detallesSolicitud,
      enviarWebSocket: true,
      enviarCorreo: false
    });

    // 3. Notificar al admin general
    await NotificacionServiceMejorado.crearNotificacionMejorada({
      tipo: NotificacionServiceMejorado.TIPOS_NOTIFICACION.SOLICITUD_APROBADA,
      id_usuario_emisor: id_aprobador,
      destinatarios_rol: 'admin_general',
      entidad: 'solicitud',
      entidad_id: id,
      detalles: detallesSolicitud,
      enviarWebSocket: true,
      enviarCorreo: false
    });

    // 4. Notificar al aprobador (confirmación)
    await NotificacionServiceMejorado.crearNotificacionMejorada({
      tipo: NotificacionServiceMejorado.TIPOS_NOTIFICACION.SOLICITUD_APROBADA,
      id_usuario_emisor: id_aprobador,
      id_usuario_destinatario: id_aprobador,
      entidad: 'solicitud',
      entidad_id: id,
      detalles: detallesSolicitud,
      enviarWebSocket: true,
      enviarCorreo: false
    });

    // Registrar la acción
    await registrarAccionSolicitud({
      req,
      accion: 'aprobó',
      solicitudId: id,
      detalles: detallesSolicitud
    });

    res.json({ 
      message: "Solicitud aprobada exitosamente",
      solicitud: {
        id,
        estado: 'autorizada',
        monto: detallesSolicitud.monto,
        solicitante: detallesSolicitud.solicitante_nombre,
        aprobador: nombre_aprobador
      }
    });

  } catch (err) {
    console.error('[SolicitudMejorada] Error aprobando solicitud:', err);
    res.status(500).json({ error: "Error al aprobar la solicitud" });
  }
}

/**
 * Función mejorada para rechazar solicitud con notificaciones específicas
 */
async function rechazarSolicitudMejorada(req, res) {
  try {
    const { id } = req.params;
    const { comentario_aprobador = 'No se especificó el motivo del rechazo' } = req.body;
    const { id_usuario: id_aprobador, nombre: nombre_aprobador } = req.user;

    // Actualizar estado en base de datos
    const filas = await SolicitudModel.actualizarEstado(
      id,
      'rechazada',
      comentario_aprobador,
      id_aprobador
    );

    if (filas === 0) {
      return res.status(404).json({ error: "Solicitud no encontrada o ya procesada." });
    }

    // Obtener datos completos de la solicitud
    const [solicitudData] = await pool.query(`
      SELECT 
        s.*,
        u.nombre as solicitante_nombre,
        u.email as solicitante_email,
        d.nombre_departamento as departamento_nombre
      FROM solicitudes_pago s
      JOIN usuarios u ON u.id_usuario = s.id_usuario
      LEFT JOIN departamentos d ON d.id_departamento = s.departamento_id
      WHERE s.id_solicitud = ?
    `, [id]);

    const solicitud = solicitudData[0];
    if (!solicitud) {
      return res.status(404).json({ error: "Datos de solicitud no encontrados." });
    }

    // Preparar detalles para las notificaciones
    const detallesSolicitud = {
      monto: parseFloat(solicitud.monto),
      concepto: solicitud.concepto,
      departamento: solicitud.departamento,
      empresa_a_pagar: solicitud.empresa_a_pagar || 'No especificada',
      solicitante_nombre: solicitud.solicitante_nombre,
      solicitante_departamento: solicitud.departamento_nombre || solicitud.departamento,
      comentario_aprobador: comentario_aprobador,
      aprobador_nombre: nombre_aprobador,
      fecha_rechazo: new Date().toLocaleDateString('es-MX'),
      motivos_comunes: [
        'Documentación incompleta',
        'Monto no justificado',
        'Proveedor no autorizado',
        'Presupuesto insuficiente'
      ]
    };

    // 1. Notificar al solicitante (prioridad alta)
    await NotificacionServiceMejorado.crearNotificacionMejorada({
      tipo: NotificacionServiceMejorado.TIPOS_NOTIFICACION.SOLICITUD_RECHAZADA,
      id_usuario_emisor: id_aprobador,
      id_usuario_destinatario: solicitud.id_usuario,
      entidad: 'solicitud',
      entidad_id: id,
      detalles: detallesSolicitud,
      enviarWebSocket: true,
      enviarCorreo: true // Siempre enviar correo para rechazos
    });

    // 2. Notificar al admin general
    await NotificacionServiceMejorado.crearNotificacionMejorada({
      tipo: NotificacionServiceMejorado.TIPOS_NOTIFICACION.SOLICITUD_RECHAZADA,
      id_usuario_emisor: id_aprobador,
      destinatarios_rol: 'admin_general',
      entidad: 'solicitud',
      entidad_id: id,
      detalles: detallesSolicitud,
      enviarWebSocket: true,
      enviarCorreo: false
    });

    // 3. Notificar al aprobador (confirmación)
    await NotificacionServiceMejorado.crearNotificacionMejorada({
      tipo: NotificacionServiceMejorado.TIPOS_NOTIFICACION.SOLICITUD_RECHAZADA,
      id_usuario_emisor: id_aprobador,
      id_usuario_destinatario: id_aprobador,
      entidad: 'solicitud',
      entidad_id: id,
      detalles: detallesSolicitud,
      enviarWebSocket: true,
      enviarCorreo: false
    });

    // Registrar la acción
    await registrarAccionSolicitud({
      req,
      accion: 'rechazó',
      solicitudId: id,
      detalles: detallesSolicitud
    });

    res.json({ 
      message: "Solicitud rechazada",
      solicitud: {
        id,
        estado: 'rechazada',
        monto: detallesSolicitud.monto,
        solicitante: detallesSolicitud.solicitante_nombre,
        aprobador: nombre_aprobador,
        motivo: comentario_aprobador
      }
    });

  } catch (err) {
    console.error('[SolicitudMejorada] Error rechazando solicitud:', err);
    res.status(500).json({ error: "Error al rechazar la solicitud" });
  }
}

/**
 * Función mejorada para procesar pago con notificaciones específicas
 */
async function procesarPagoMejorado(req, res) {
  try {
    const { id } = req.params;
    const { id_usuario: id_pagador, nombre: nombre_pagador } = req.user;

    // Marcar como pagada
    const filas = await SolicitudModel.marcarComoPagada(id, id_pagador);
    
    if (filas === 0) {
      return res.status(404).json({ error: "Solicitud no encontrada o no está autorizada para pago." });
    }

    // Obtener datos completos de la solicitud
    const [solicitudData] = await pool.query(`
      SELECT 
        s.*,
        u.nombre as solicitante_nombre,
        u.email as solicitante_email,
        d.nombre_departamento as departamento_nombre,
        u_aprobador.nombre as aprobador_nombre,
        u_aprobador.email as aprobador_email
      FROM solicitudes_pago s
      JOIN usuarios u ON u.id_usuario = s.id_usuario
      LEFT JOIN departamentos d ON d.id_departamento = s.departamento_id
      LEFT JOIN usuarios u_aprobador ON u_aprobador.id_usuario = s.id_aprobador
      WHERE s.id_solicitud = ?
    `, [id]);

    const solicitud = solicitudData[0];
    if (!solicitud) {
      return res.status(404).json({ error: "Datos de solicitud no encontrados." });
    }

    // Preparar detalles para las notificaciones
    const detallesSolicitud = {
      monto: parseFloat(solicitud.monto),
      concepto: solicitud.concepto,
      departamento: solicitud.departamento,
      cuenta_destino: solicitud.cuenta_destino,
      tipo_pago: solicitud.tipo_pago,
      solicitante_nombre: solicitud.solicitante_nombre,
      solicitante_departamento: solicitud.departamento_nombre || solicitud.departamento,
      aprobador_nombre: solicitud.aprobador_nombre,
      pagador_nombre: nombre_pagador,
      fecha_pago: new Date().toLocaleDateString('es-MX'),
      referencia_pago: `REF-${id}-${Date.now()}` // Generar referencia única
    };

    // 1. Notificar al solicitante (prioridad alta)
    await NotificacionServiceMejorado.crearNotificacionMejorada({
      tipo: NotificacionServiceMejorado.TIPOS_NOTIFICACION.SOLICITUD_PAGADA,
      id_usuario_emisor: id_pagador,
      id_usuario_destinatario: solicitud.id_usuario,
      entidad: 'solicitud',
      entidad_id: id,
      detalles: detallesSolicitud,
      enviarWebSocket: true,
      enviarCorreo: true // Siempre enviar correo para pagos
    });

    // 2. Notificar al aprobador (si existe)
    if (solicitud.id_aprobador) {
      await NotificacionServiceMejorado.crearNotificacionMejorada({
        tipo: NotificacionServiceMejorado.TIPOS_NOTIFICACION.SOLICITUD_PAGADA,
        id_usuario_emisor: id_pagador,
        id_usuario_destinatario: solicitud.id_aprobador,
        entidad: 'solicitud',
        entidad_id: id,
        detalles: detallesSolicitud,
        enviarWebSocket: true,
        enviarCorreo: false
      });
    }

    // 3. Notificar al admin general
    await NotificacionServiceMejorado.crearNotificacionMejorada({
      tipo: NotificacionServiceMejorado.TIPOS_NOTIFICACION.SOLICITUD_PAGADA,
      id_usuario_emisor: id_pagador,
      destinatarios_rol: 'admin_general',
      entidad: 'solicitud',
      entidad_id: id,
      detalles: detallesSolicitud,
      enviarWebSocket: true,
      enviarCorreo: false
    });

    // 4. Notificar al pagador (confirmación)
    await NotificacionServiceMejorado.crearNotificacionMejorada({
      tipo: NotificacionServiceMejorado.TIPOS_NOTIFICACION.SOLICITUD_PAGADA,
      id_usuario_emisor: id_pagador,
      id_usuario_destinatario: id_pagador,
      entidad: 'solicitud',
      entidad_id: id,
      detalles: detallesSolicitud,
      enviarWebSocket: true,
      enviarCorreo: false
    });

    // Registrar la acción
    await registrarAccionSolicitud({
      req,
      accion: 'pagó',
      solicitudId: id,
      detalles: detallesSolicitud
    });

    res.json({ 
      message: "Pago procesado exitosamente",
      solicitud: {
        id,
        estado: 'pagada',
        monto: detallesSolicitud.monto,
        solicitante: detallesSolicitud.solicitante_nombre,
        pagador: nombre_pagador,
        referencia: detallesSolicitud.referencia_pago,
        fecha_pago: detallesSolicitud.fecha_pago
      }
    });

  } catch (err) {
    console.error('[SolicitudMejorada] Error procesando pago:', err);
    res.status(500).json({ error: "Error al procesar el pago" });
  }
}

/**
 * Función mejorada para aprobar solicitudes en lote
 */
async function aprobarLoteMejorado(req, res) {
  try {
    const { ids = [], comentario_aprobador = '' } = req.body;
    const { id_usuario: id_aprobador, nombre: nombre_aprobador } = req.user;

    if (!Array.isArray(ids) || ids.length === 0) {
      return res.status(400).json({ error: 'Debes enviar un arreglo de IDs válido' });
    }

    // Obtener datos de las solicitudes antes de procesarlas
    const [solicitudesData] = await pool.query(`
      SELECT 
        s.id_solicitud,
        s.id_usuario,
        s.monto,
        s.concepto,
        s.departamento,
        u.nombre as solicitante_nombre,
        u.email as solicitante_email
      FROM solicitudes_pago s
      JOIN usuarios u ON u.id_usuario = s.id_usuario
      WHERE s.id_solicitud IN (${ids.map(() => '?').join(',')}) AND s.estado = 'pendiente'
    `, ids);

    if (solicitudesData.length === 0) {
      return res.status(400).json({ error: 'No hay solicitudes válidas para procesar' });
    }

    // Procesar cada solicitud
    const solicitudesProcesadas = [];
    let montoTotal = 0;

    for (const solicitud of solicitudesData) {
      try {
        const filas = await SolicitudModel.actualizarEstado(
          solicitud.id_solicitud,
          'autorizada', 
          comentario_aprobador,
          id_aprobador
        );

        if (filas > 0) {
          solicitudesProcesadas.push(solicitud);
          montoTotal += parseFloat(solicitud.monto);

          // Notificar al solicitante individualmente
          await NotificacionServiceMejorado.crearNotificacionMejorada({
            tipo: NotificacionServiceMejorado.TIPOS_NOTIFICACION.SOLICITUD_APROBADA,
            id_usuario_emisor: id_aprobador,
            id_usuario_destinatario: solicitud.id_usuario,
            entidad: 'solicitud',
            entidad_id: solicitud.id_solicitud,
            detalles: {
              monto: parseFloat(solicitud.monto),
              concepto: solicitud.concepto,
              departamento: solicitud.departamento,
              solicitante_nombre: solicitud.solicitante_nombre,
              aprobador_nombre: nombre_aprobador,
              aprobacion_lote: true,
              comentario_aprobador
            },
            enviarWebSocket: true,
            enviarCorreo: true
          });
        }
      } catch (error) {
        console.error(`Error procesando solicitud ${solicitud.id_solicitud}:`, error);
      }
    }

    // Notificar sobre la operación en lote al admin
    if (solicitudesProcesadas.length > 0) {
      await NotificacionServiceMejorado.crearNotificacionMejorada({
        tipo: NotificacionServiceMejorado.TIPOS_NOTIFICACION.LOTE_APROBADO,
        id_usuario_emisor: id_aprobador,
        destinatarios_rol: 'admin_general',
        entidad: 'solicitud',
        entidad_id: solicitudesProcesadas.map(s => s.id_solicitud).join(','),
        detalles: {
          cantidad: solicitudesProcesadas.length,
          monto_total: montoTotal,
          tipo_entidad: 'solicitud',
          aprobador_nombre: nombre_aprobador,
          comentario: comentario_aprobador
        },
        enviarWebSocket: true,
        enviarCorreo: false
      });

      // Notificar a pagadores sobre nuevas solicitudes autorizadas
      await NotificacionServiceMejorado.crearNotificacionMejorada({
        tipo: NotificacionServiceMejorado.TIPOS_NOTIFICACION.LOTE_APROBADO,
        id_usuario_emisor: id_aprobador,
        destinatarios_rol: 'pagador_banca',
        entidad: 'solicitud',
        entidad_id: solicitudesProcesadas.map(s => s.id_solicitud).join(','),
        detalles: {
          cantidad: solicitudesProcesadas.length,
          monto_total: montoTotal,
          tipo_entidad: 'solicitud',
          aprobador_nombre: nombre_aprobador
        },
        enviarWebSocket: true,
        enviarCorreo: false
      });
    }

    res.json({ 
      message: `Se aprobaron ${solicitudesProcesadas.length} solicitudes exitosamente`,
      solicitudes_procesadas: solicitudesProcesadas.length,
      monto_total: montoTotal,
      ids_procesados: solicitudesProcesadas.map(s => s.id_solicitud)
    });

  } catch (err) {
    console.error('[SolicitudMejorada] Error aprobando lote:', err);
    res.status(500).json({ error: "Error al aprobar solicitudes en lote" });
  }
}

module.exports = {
  aprobarSolicitudMejorada,
  rechazarSolicitudMejorada,
  procesarPagoMejorado,
  aprobarLoteMejorado
};
