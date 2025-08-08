/* ──────────────────────────────────────────────────────────────
   Controlador de Plantillas Recurrentes
   Con notificaciones (BD + WS + correo) – Flujo acordado
   ────────────────────────────────────────────────────────────── */

const RecurrenteModel      = require("../models/recurrente.model");
const SolicitudModel       = require("../models/solicitud.model"); // Para historial
const NotificacionService  = require("../services/notificacionesService");
const pool                 = require("../db/connection");

/* ────────────── Crear plantilla recurrente ────────────── */
exports.crearRecurrente = async (req, res) => {
  try {
    const { id_usuario } = req.user;
    const {
      departamento, monto, cuenta_destino,
      concepto, tipo_pago, tipo_pago_descripcion, empresa_a_pagar, nombre_persona,
      tipo_cuenta_destino, tipo_tarjeta, banco_destino, frecuencia, siguiente_fecha,
    } = req.body;

    if (!departamento || !monto || !cuenta_destino || !concepto ||
        !tipo_pago || !frecuencia || !siguiente_fecha) {
      return res.status(400).json({ error: "Faltan datos obligatorios" });
    }

    let fact_recurrente = null;
    if (req.file) {
      fact_recurrente = `/uploads/recurrente/${req.file.filename}`;
    }
    await RecurrenteModel.crearRecurrente({
      id_usuario, departamento, monto, cuenta_destino,
      concepto, tipo_pago, tipo_pago_descripcion, empresa_a_pagar, nombre_persona,
      tipo_cuenta_destino, tipo_tarjeta, banco_destino, frecuencia, siguiente_fecha, fact_recurrente
    });

    // Detalles para el correo
    const detallesRecurrente = `
      <b>Departamento:</b> ${departamento}<br>
      <b>Monto:</b> $${monto}<br>
      <b>Cuenta destino:</b> ${cuenta_destino}<br>
      <b>Concepto:</b> ${concepto}<br>
      <b>Tipo de pago:</b> ${tipo_pago}<br>
      ${tipo_pago_descripcion ? `<b>Descripción tipo pago:</b> ${tipo_pago_descripcion}<br>` : ''}
      ${empresa_a_pagar ? `<b>Empresa a pagar:</b> ${empresa_a_pagar}<br>` : ''}
      ${nombre_persona ? `<b>Nombre persona:</b> ${nombre_persona}<br>` : ''}
      ${tipo_cuenta_destino ? `<b>Tipo cuenta destino:</b> ${tipo_cuenta_destino}<br>` : ''}
      ${tipo_tarjeta ? `<b>Tipo tarjeta:</b> ${tipo_tarjeta}<br>` : ''}
      ${banco_destino ? `<b>Banco destino:</b> ${banco_destino}<br>` : ''}
      <b>Frecuencia:</b> ${frecuencia}<br>
      <b>Siguiente fecha:</b> ${siguiente_fecha}<br>
      ${fact_recurrente ? `<b>Factura adjunta:</b> ${fact_recurrente}<br>` : ''}
    `;

    // Enviar correo al admin_general
    const { enviarCorreo } = require('../services/correoService');
    const [admins] = await pool.query("SELECT email, nombre FROM usuarios WHERE rol = 'admin_general'");
    const url = 'https://bechapra.com';
    if (admins.length > 0) {
      const admin = admins[0];
      await enviarCorreo({
        para: admin.email,
        asunto: 'Nueva plantilla recurrente creada en Bechapra',
        nombre: admin.nombre,
        link: url,
        mensaje: `Se ha creado una nueva plantilla recurrente por el usuario ID ${id_usuario}:<br>${detallesRecurrente}`
      });
    }

    /* 🔔 Aprobadores */
    const [aprobadores] = await pool.query(
      "SELECT id_usuario, email FROM usuarios WHERE rol = 'aprobador'"
    );
    const { nombre: nombreSolicitante } = req.user;
    for (const ap of aprobadores) {
      await NotificacionService.crearNotificacion({
        id_usuario: ap.id_usuario,
        mensaje: `📋 Nueva plantilla recurrente de ${nombreSolicitante || 'Usuario'} por $${monto.toLocaleString()} - ${concepto}`,
        correo: ap.email,
      });
    }

    // Enviar correo al solicitante
    const [solicitante] = await pool.query("SELECT email, nombre FROM usuarios WHERE id_usuario = ?", [id_usuario]);
    await enviarCorreo({
      para: solicitante[0]?.email,
      asunto: 'Plantilla recurrente registrada exitosamente',
      nombre: solicitante[0]?.nombre,
      link: url,
      mensaje: `¡Tu plantilla recurrente fue registrada exitosamente!<br>${detallesRecurrente}`
    });
    await NotificacionService.crearNotificacion({
      id_usuario,
      mensaje: `✅ Tu plantilla recurrente por $${monto.toLocaleString()} fue registrada exitosamente`,
    });
    res.status(201).json({ message: "Plantilla recurrente creada correctamente" });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Error al crear la plantilla recurrente" });
  }
};

//  ──────────────── Marcar como pagada (pagador) ─────────────────
exports.marcarComoPagadaRecurrente = async (req, res) => {
  try {
    const { id } = req.params;
    const { rol, id_usuario: id_pagador } = req.user;

    if (rol !== "pagador_banca") {
      return res.status(403).json({ error: "No tienes permisos para marcar la recurrente como pagada" });
    }

    const filas = await RecurrenteModel.marcarComoPagadaRecurrente(id, id_pagador);
    if (filas === 0) {
      // Verifica el estado actual en BD para debug
      const [rows] = await pool.query(
        `SELECT estado FROM pagos_recurrentes WHERE id_recurrente = ?`,
        [id]
      );
      const estadoActual = rows[0]?.estado;
      return res.status(404).json({ error: `No se pudo marcar como pagada. Estado actual: ${estadoActual}` });
    }

    // Obtener detalles y correos
    const [rows] = await pool.query(
      `SELECT r.id_usuario AS idSolicitante,
              us.email AS emailSolic,
              us.nombre AS nombreSolic,
              r.id_aprobador,
              ua.email AS emailAprob,
              ua.nombre AS nombreAprob,
              r.departamento, r.monto, r.cuenta_destino, r.concepto, r.tipo_pago, r.frecuencia, r.siguiente_fecha, r.fact_recurrente
       FROM pagos_recurrentes r
       JOIN usuarios us ON us.id_usuario = r.id_usuario
       LEFT JOIN usuarios ua ON ua.id_usuario = r.id_aprobador
       WHERE r.id_recurrente = ?`,
      [id]
    );

    if (rows.length) {
      const { idSolicitante, emailSolic, nombreSolic, id_aprobador, emailAprob, nombreAprob, departamento, monto, cuenta_destino, concepto, tipo_pago, frecuencia, siguiente_fecha, fact_recurrente } = rows[0];

      // Obtener info de admin
      const [adminRows] = await pool.query("SELECT email, nombre FROM usuarios WHERE rol = 'admin_general'");
      const url = 'https://bechapra.com';
      const detallesRecurrente = `
        <b>ID:</b> ${id}<br>
        <b>Departamento:</b> ${departamento}<br>
        <b>Monto:</b> $${monto}<br>
        <b>Cuenta destino:</b> ${cuenta_destino}<br>
        <b>Concepto:</b> ${concepto}<br>
        <b>Tipo de pago:</b> ${tipo_pago || '-'}<br>
        <b>Frecuencia:</b> ${frecuencia || '-'}<br>
        <b>Siguiente fecha:</b> ${siguiente_fecha || '-'}<br>
        ${fact_recurrente ? `<b>Factura adjunta:</b> ${fact_recurrente}<br>` : ''}
      `;
      const { enviarCorreo } = require('../services/correoService');

      // Correo al admin
      if (adminRows.length > 0) {
        const admin = adminRows[0];
        await enviarCorreo({
          para: admin.email,
          asunto: 'Plantilla recurrente pagada',
          nombre: admin.nombre,
          link: url,
          mensaje: `El pagador ID ${id_pagador} ha <b>marcado como pagada</b> la siguiente plantilla recurrente:<br>${detallesRecurrente}`
        });
      }
      // Correo al aprobador (si existe)
      if (id_aprobador && emailAprob) {
        await enviarCorreo({
          para: emailAprob,
          asunto: 'Plantilla recurrente pagada',
          nombre: nombreAprob,
          link: url,
          mensaje: `La plantilla recurrente que aprobaste ha sido <b>pagada</b>:<br>${detallesRecurrente}`
        });
      }
      // Correo al solicitante
      if (emailSolic) {
        await enviarCorreo({
          para: emailSolic,
          asunto: 'Tu plantilla recurrente ha sido pagada',
          nombre: nombreSolic,
          link: url,
          mensaje: `¡Tu plantilla recurrente ha sido <b>pagada</b>!<br>${detallesRecurrente}`
        });
      }

      // Solicitante (notificación in-app)
      await NotificacionService.crearNotificacion({
        id_usuario: idSolicitante,
        mensaje: `💸 Tu pago recurrente por $${monto.toLocaleString()} ha sido marcado como pagado por ${req.user.nombre || 'Pagador'}`,
        correo: emailSolic,
      });

      // Aprobador (si existe, notificación in-app)
      if (id_aprobador && emailAprob) {
        await NotificacionService.crearNotificacion({
          id_usuario: id_aprobador,
          mensaje: `💸 Plantilla recurrente #${id} que aprobaste por $${monto.toLocaleString()} fue pagada`,
          correo: emailAprob,
        });
      }

      // Pagador (su propio historial)
      const [pagador] = await pool.query("SELECT email, nombre FROM usuarios WHERE id_usuario = ?", [id_pagador]);
      await NotificacionService.crearNotificacion({
        id_usuario: id_pagador,
        mensaje: `✅ Pagaste plantilla recurrente #${id} por $${monto.toLocaleString()} a ${nombreSolic}`,
        correo: pagador[0]?.email
      });
    }

    res.json({ message: "Plantilla recurrente marcada como pagada correctamente" });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Error al marcar la recurrente como pagada" });
  }
};

/* ────────────── Obtener plantillas del usuario ────────────── */
exports.obtenerRecurrentes = async (req, res) => {
  try {
    const { id_usuario, rol } = req.user;
    let recurrentes;
    if (rol === 'admin_general' || rol === 'pagador_banca') {
      recurrentes = await RecurrenteModel.obtenerTodas();
    } else {
      recurrentes = await RecurrenteModel.obtenerRecurrentesPorUsuario(id_usuario);
    }
    res.json(recurrentes);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Error al obtener las plantillas recurrentes" });
  }
};

/* ────────────── Pausar o reactivar plantilla ────────────── */
exports.cambiarEstadoActiva = async (req, res) => {
  try {
    const { id } = req.params;
    const { activo } = req.body;
    console.log('CONTROLADOR cambiarEstadoActiva:', { id, activo });
    const recurrenteActualizado = await RecurrenteModel.cambiarEstadoActivo(id, activo);
    res.json({
      message: `Plantilla ${activo ? 'reactivada' : 'pausada'} correctamente`,
      recurrente: recurrenteActualizado
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Error al cambiar el estado de la plantilla" });
  }
};

/* ────────────── Obtener plantillas pendientes ────────────── */
exports.obtenerPendientes = async (_req, res) => {
  try {
    const pendientes = await RecurrenteModel.obtenerPendientes();
    res.json(pendientes);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Error al obtener las plantillas pendientes" });
  }
};

/* ────────────── Aprobar plantilla ────────────── */
exports.aprobarRecurrente = async (req, res) => {
  try {
    const { id } = req.params;
    const { id_usuario } = req.user; // id_usuario es el aprobador

    await RecurrenteModel.aprobarRecurrente(id, id_usuario);

    // Obtener detalles de la solicitud y usuarios
    const recurrente = await RecurrenteModel.getPorId(id);
    if (!recurrente) {
      return res.status(404).json({ error: "Plantilla recurrente no encontrada" });
    }
    const [adminRows] = await pool.query("SELECT email, nombre FROM usuarios WHERE rol = 'admin_general'");
    const [aprobadorRows] = await pool.query("SELECT email, nombre FROM usuarios WHERE id_usuario = ?", [id_usuario]);
    const [solicitanteRows] = await pool.query("SELECT email, nombre FROM usuarios WHERE id_usuario = ?", [recurrente.id_usuario]);
    const url = 'https://bechapra.com';
    const detallesRecurrente = `
      <b>ID:</b> ${recurrente.id_recurrente || recurrente.id}<br>
      <b>Departamento:</b> ${recurrente.departamento}<br>
      <b>Monto:</b> $${recurrente.monto}<br>
      <b>Cuenta destino:</b> ${recurrente.cuenta_destino}<br>
      <b>Concepto:</b> ${recurrente.concepto}<br>
      <b>Tipo de pago:</b> ${recurrente.tipo_pago}<br>
      <b>Frecuencia:</b> ${recurrente.frecuencia}<br>
      <b>Siguiente fecha:</b> ${recurrente.siguiente_fecha || ''}<br>
      ${recurrente.fact_recurrente ? `<b>Factura adjunta:</b> ${recurrente.fact_recurrente}<br>` : ''}
    `;
    const { enviarCorreo } = require('../services/correoService');
    // Correo al admin
    if (adminRows.length > 0) {
      const admin = adminRows[0];
      await enviarCorreo({
        para: admin.email,
        asunto: 'Plantilla recurrente aprobada',
        nombre: admin.nombre,
        link: url,
        mensaje: `El aprobador ID ${id_usuario} ha <b>aprobado</b> una plantilla recurrente:<br>${detallesRecurrente}`
      });
    }
    // Correo al aprobador
    if (aprobadorRows.length > 0) {
      const aprobador = aprobadorRows[0];
      await enviarCorreo({
        para: aprobador.email,
        asunto: 'Confirmación de aprobación de plantilla recurrente',
        nombre: aprobador.nombre,
        link: url,
        mensaje: `Has <b>aprobado</b> la siguiente plantilla recurrente:<br>${detallesRecurrente}`
      });
    }
    // Correo al solicitante
    if (solicitanteRows.length > 0) {
      const solicitante = solicitanteRows[0];
      await enviarCorreo({
        para: solicitante.email,
        asunto: 'Tu plantilla recurrente fue aprobada',
        nombre: solicitante.nombre,
        link: url,
        mensaje: `¡Tu plantilla recurrente fue <b>aprobada</b>!<br>${detallesRecurrente}`
      });
    }

    /* 🔔 Solicitante (notificación in-app) */
    if (solicitanteRows.length > 0) {
      await NotificacionService.crearNotificacion({
        id_usuario: recurrente.id_usuario,
        mensaje: `✅ Tu plantilla recurrente por $${recurrente.monto.toLocaleString()} fue aprobada por ${req.user.nombre || 'Aprobador'}`,
        correo: solicitanteRows[0].email,
      });
    }
    /* 🔔 Pagadores */
    const [pagadores] = await pool.query(
      "SELECT id_usuario, email FROM usuarios WHERE rol = 'pagador_banca'"
    );
    for (const pg of pagadores) {
      await NotificacionService.crearNotificacion({
        id_usuario: pg.id_usuario,
        mensaje: `� Nueva plantilla recurrente aprobada: $${recurrente.monto.toLocaleString()} - ${recurrente.concepto} (${solicitanteRows[0]?.nombre})`,
        correo: pg.email,
      });
    }

    res.json({ message: "Plantilla aprobada correctamente" });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Error al aprobar la plantilla" });
  }
};

/* ────────────── Rechazar plantilla ────────────── */
exports.rechazarRecurrente = async (req, res) => {
  try {
    const { id } = req.params;
    const { id_usuario } = req.user; // id_usuario es el aprobador
    const { comentario_aprobador } = req.body;

    await RecurrenteModel.rechazarRecurrente(id, id_usuario, comentario_aprobador);

    // Obtener detalles de la solicitud y usuarios
    const recurrente = await RecurrenteModel.getPorId(id);
    if (!recurrente) {
      return res.status(404).json({ error: "Plantilla recurrente no encontrada" });
    }
    const [adminRows] = await pool.query("SELECT email, nombre FROM usuarios WHERE rol = 'admin_general'");
    const [aprobadorRows] = await pool.query("SELECT email, nombre FROM usuarios WHERE id_usuario = ?", [id_usuario]);
    const [solicitanteRows] = await pool.query("SELECT email, nombre FROM usuarios WHERE id_usuario = ?", [recurrente.id_usuario]);
    const url = 'https://bechapra.com';
    const detallesRecurrente = `
      <b>ID:</b> ${recurrente.id_recurrente || recurrente.id}<br>
      <b>Departamento:</b> ${recurrente.departamento}<br>
      <b>Monto:</b> $${recurrente.monto}<br>
      <b>Cuenta destino:</b> ${recurrente.cuenta_destino}<br>
      <b>Concepto:</b> ${recurrente.concepto}<br>
      <b>Tipo de pago:</b> ${recurrente.tipo_pago}<br>
      <b>Frecuencia:</b> ${recurrente.frecuencia}<br>
      <b>Siguiente fecha:</b> ${recurrente.siguiente_fecha || ''}<br>
      ${recurrente.fact_recurrente ? `<b>Factura adjunta:</b> ${recurrente.fact_recurrente}<br>` : ''}
      <b>Comentario del aprobador:</b> ${comentario_aprobador || ''}<br>
    `;
    const { enviarCorreo } = require('../services/correoService');
    // Correo al admin
    if (adminRows.length > 0) {
      const admin = adminRows[0];
      await enviarCorreo({
        para: admin.email,
        asunto: 'Plantilla recurrente rechazada',
        nombre: admin.nombre,
        link: url,
        mensaje: `El aprobador ID ${id_usuario} ha <b>rechazado</b> una plantilla recurrente:<br>${detallesRecurrente}`
      });
    }
    // Correo al aprobador
    if (aprobadorRows.length > 0) {
      const aprobador = aprobadorRows[0];
      await enviarCorreo({
        para: aprobador.email,
        asunto: 'Confirmación de rechazo de plantilla recurrente',
        nombre: aprobador.nombre,
        link: url,
        mensaje: `Has <b>rechazado</b> la siguiente plantilla recurrente:<br>${detallesRecurrente}`
      });
    }
    // Correo al solicitante
    if (solicitanteRows.length > 0) {
      const solicitante = solicitanteRows[0];
      await enviarCorreo({
        para: solicitante.email,
        asunto: 'Tu plantilla recurrente fue rechazada',
        nombre: solicitante.nombre,
        link: url,
        mensaje: `Tu plantilla recurrente fue <b>rechazada</b>.<br>${detallesRecurrente}`
      });
    }

    // 🔔 Notificar al solicitante solamente (in-app)
    if (solicitanteRows.length > 0) {
      await NotificacionService.crearNotificacion({
        id_usuario: recurrente.id_usuario,
        mensaje: `❌ Tu plantilla recurrente por $${recurrente.monto.toLocaleString()} fue rechazada por ${req.user.nombre || 'Aprobador'}`,
        correo: solicitanteRows[0].email,
      });
    }

    res.json({ message: "Plantilla rechazada correctamente" });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Error al rechazar la plantilla" });
  }
};

/* ────────────── Eliminar plantilla ────────────── */
exports.eliminarRecurrente = async (req, res) => {
  try {
    const { id } = req.params;

    // Obtener detalles antes de eliminar
    const recurrente = await RecurrenteModel.getPorId(id);
    if (!recurrente) {
      return res.status(404).json({ error: "Plantilla recurrente no encontrada" });
    }

    // Enviar correo al admin_general con los detalles
    const { enviarCorreo } = require('../services/correoService');
    const [admins] = await pool.query("SELECT email, nombre FROM usuarios WHERE rol = 'admin_general'");
    const url = 'https://bechapra.com';
    if (admins.length > 0) {
      const admin = admins[0];
      const detallesRecurrente = `
        <b>ID:</b> ${recurrente.id_recurrente || recurrente.id}<br>
        <b>Departamento:</b> ${recurrente.departamento}<br>
        <b>Monto:</b> $${recurrente.monto}<br>
        <b>Cuenta destino:</b> ${recurrente.cuenta_destino}<br>
        <b>Concepto:</b> ${recurrente.concepto}<br>
        <b>Tipo de pago:</b> ${recurrente.tipo_pago}<br>
        <b>Frecuencia:</b> ${recurrente.frecuencia}<br>
        <b>Siguiente fecha:</b> ${recurrente.siguiente_fecha || ''}<br>
        <b>Usuario solicitante:</b> ${recurrente.id_usuario || ''}<br>
        ${recurrente.fact_recurrente ? `<b>Factura adjunta:</b> ${recurrente.fact_recurrente}<br>` : ''}
      `;
      await enviarCorreo({
        para: admin.email,
        asunto: 'Plantilla recurrente eliminada en Bechapra',
        nombre: admin.nombre,
        link: url,
        mensaje: `Se ha eliminado una plantilla recurrente con los siguientes detalles:<br>${detallesRecurrente}`
      });
    }

    // Eliminar la plantilla
    await RecurrenteModel.eliminarRecurrente(id);
    res.json({ message: "Plantilla recurrente eliminada correctamente" });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Error al eliminar la plantilla recurrente" });
  }
};

/* ────────────── Editar plantilla (si está pendiente) ────────────── */
exports.editarRecurrente = async (req, res) => {
  try {
    const { id } = req.params;
    const { id_usuario, email } = req.user;
    const {
      departamento, monto, cuenta_destino,
      concepto, tipo_pago, tipo_pago_descripcion, empresa_a_pagar, nombre_persona,
      tipo_cuenta_destino, tipo_tarjeta, banco_destino, frecuencia, siguiente_fecha,
    } = req.body;

    if (!departamento || !monto || !cuenta_destino || !concepto ||
        !tipo_pago || !frecuencia || !siguiente_fecha) {
      return res.status(400).json({ error: "Faltan datos obligatorios" });
    }

    let fact_recurrente = undefined;
    if (req.file) {
      fact_recurrente = `/uploads/recurrente/${req.file.filename}`;
    }
    const filas = await RecurrenteModel.editarRecurrenteSiPendiente(id, id_usuario, {
      departamento, monto, cuenta_destino,
      concepto, tipo_pago, tipo_pago_descripcion, empresa_a_pagar, nombre_persona,
      tipo_cuenta_destino, tipo_tarjeta, banco_destino, frecuencia, siguiente_fecha,
      fact_recurrente
    });

    if (filas === 0) {
      return res.status(403).json({
        error: "No puedes editar esta plantilla. Asegúrate de que te pertenece y esté pendiente.",
      });
    }

    // Notificación in-app
    await NotificacionService.crearNotificacion({
      id_usuario,
      mensaje: "✏️ Tu plantilla recurrente fue actualizada.",
      correo: email,
    });

    // Detalles para el correo
    const detallesRecurrente = `
      <b>Departamento:</b> ${departamento}<br>
      <b>Monto:</b> $${monto}<br>
      <b>Cuenta destino:</b> ${cuenta_destino}<br>
      <b>Concepto:</b> ${concepto}<br>
      <b>Tipo de pago:</b> ${tipo_pago}<br>
      ${tipo_pago_descripcion ? `<b>Descripción tipo pago:</b> ${tipo_pago_descripcion}<br>` : ''}
      ${empresa_a_pagar ? `<b>Empresa a pagar:</b> ${empresa_a_pagar}<br>` : ''}
      ${nombre_persona ? `<b>Nombre persona:</b> ${nombre_persona}<br>` : ''}
      ${tipo_cuenta_destino ? `<b>Tipo cuenta destino:</b> ${tipo_cuenta_destino}<br>` : ''}
      ${tipo_tarjeta ? `<b>Tipo tarjeta:</b> ${tipo_tarjeta}<br>` : ''}
      ${banco_destino ? `<b>Banco destino:</b> ${banco_destino}<br>` : ''}
      <b>Frecuencia:</b> ${frecuencia}<br>
      <b>Siguiente fecha:</b> ${siguiente_fecha}<br>
      ${fact_recurrente ? `<b>Factura adjunta:</b> ${fact_recurrente}<br>` : ''}
    `;

    // Enviar correo al admin_general
    const { enviarCorreo } = require('../services/correoService');
    const [admins] = await pool.query("SELECT email, nombre FROM usuarios WHERE rol = 'admin_general'");
    const url = 'https://bechapra.com';
    if (admins.length > 0) {
      const admin = admins[0];
      await enviarCorreo({
        para: admin.email,
        asunto: 'Plantilla recurrente actualizada en Bechapra',
        nombre: admin.nombre,
        link: url,
        mensaje: `El usuario ID ${id_usuario} ha actualizado una plantilla recurrente:<br>${detallesRecurrente}`
      });
    }

    // Enviar correo al solicitante
    const [solicitante] = await pool.query("SELECT email, nombre FROM usuarios WHERE id_usuario = ?", [id_usuario]);
    await enviarCorreo({
      para: solicitante[0]?.email,
      asunto: 'Tu plantilla recurrente fue actualizada',
      nombre: solicitante[0]?.nombre,
      link: url,
      mensaje: `¡Tu plantilla recurrente fue actualizada exitosamente!<br>${detallesRecurrente}`
    });

    res.json({ message: "Plantilla recurrente actualizada correctamente" });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Error al editar la plantilla recurrente" });
  }
};

/* ────────────── Historial de ejecuciones ────────────── */
exports.obtenerHistorial = async (req, res) => {
  try {
    const { rol, id_usuario } = req.user;
    const { id } = req.params;

    let historial = [];
    if (rol === "admin_general") {
      historial = await RecurrenteModel.obtenerHistorialCompleto();
    } else if (id) {
      historial = await SolicitudModel.getPorRecurrente(id);
    } else {
      historial = await RecurrenteModel.obtenerHistorialPorUsuario(id_usuario);
        // Detalles para el correo
        const detallesRecurrente = `
          <b>Departamento:</b> ${departamento}<br>
          <b>Monto:</b> $${monto}<br>
          <b>Cuenta destino:</b> ${cuenta_destino}<br>
          <b>Concepto:</b> ${concepto}<br>
          <b>Tipo de pago:</b> ${tipo_pago}<br>
          <b>Frecuencia:</b> ${frecuencia}<br>
          <b>Siguiente fecha:</b> ${siguiente_fecha}<br>
          ${fact_recurrente ? `<b>Factura adjunta:</b> ${fact_recurrente}<br>` : ''}
        `;

        // Enviar correo al admin_general
        const { enviarCorreo } = require('../services/correoService');
        const [admins] = await pool.query("SELECT email, nombre FROM usuarios WHERE rol = 'admin_general'");
        const url = 'https://bechapra.com';
        if (admins.length > 0) {
            const admin = admins[0];
            await enviarCorreo({
                para: admin.email,
                asunto: 'Plantilla recurrente actualizada en Bechapra',
                nombre: admin.nombre,
                link: url,
                mensaje: `El usuario ID ${id_usuario} ha actualizado una plantilla recurrente:<br>${detallesRecurrente}`
            });
        }

        // Enviar correo al solicitante
        const [solicitante] = await pool.query("SELECT email, nombre FROM usuarios WHERE id_usuario = ?", [id_usuario]);
        await enviarCorreo({
            para: solicitante[0]?.email,
            asunto: 'Tu plantilla recurrente fue actualizada',
            nombre: solicitante[0]?.nombre,
            link: url,
            mensaje: `¡Tu plantilla recurrente fue actualizada exitosamente!<br>${detallesRecurrente}`
        });
    }

    res.json(historial);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Error al obtener historial de ejecuciones" });
  }
};

// Subir factura recurrente
exports.subirFacturaRecurrente = async (req, res) => {
  try {
    const { id } = req.params;
    const { id_usuario, rol } = req.user;
    if (!req.file) return res.status(400).json({ error: 'No se subió ningún archivo' });

    // Validar dueño o admin_general
    const [rows] = await pool.query('SELECT id_usuario, id_aprobador FROM pagos_recurrentes WHERE id_recurrente = ?', [id]);
    if (!rows.length) return res.status(404).json({ error: 'Plantilla no encontrada' });
    if (rol !== 'admin_general' && rows[0].id_usuario !== id_usuario) {
      return res.status(403).json({ error: 'No tienes permiso para subir la factura' });
    }

    // Guardar ruta en la BD
    const fact_recurrente = `/uploads/recurrente/${req.file.filename}`;
    await pool.query('UPDATE pagos_recurrentes SET fact_recurrente = ? WHERE id_recurrente = ?', [fact_recurrente, id]);

    // Obtener detalles y correos
    const [det] = await pool.query(
      `SELECT r.id_usuario AS idSolicitante,
              us.email AS emailSolic,
              us.nombre AS nombreSolic,
              r.id_aprobador,
              ua.email AS emailAprob,
              ua.nombre AS nombreAprob,
              r.departamento, r.monto, r.cuenta_destino, r.concepto, r.tipo_pago, r.frecuencia, r.siguiente_fecha
       FROM pagos_recurrentes r
       JOIN usuarios us ON us.id_usuario = r.id_usuario
       LEFT JOIN usuarios ua ON ua.id_usuario = r.id_aprobador
       WHERE r.id_recurrente = ?`,
      [id]
    );

    if (det.length) {
      const { idSolicitante, emailSolic, nombreSolic, id_aprobador, emailAprob, nombreAprob, departamento, monto, cuenta_destino, concepto, tipo_pago, frecuencia, siguiente_fecha } = det[0];

      // Obtener info de admin
      const [adminRows] = await pool.query("SELECT email, nombre FROM usuarios WHERE rol = 'admin_general'");
      const url = 'https://bechapra.com';
      const detallesRecurrente = `
        <b>ID:</b> ${id}<br>
        <b>Departamento:</b> ${departamento}<br>
        <b>Monto:</b> $${monto}<br>
        <b>Cuenta destino:</b> ${cuenta_destino}<br>
        <b>Concepto:</b> ${concepto}<br>
        <b>Tipo de pago:</b> ${tipo_pago || '-'}<br>
        <b>Frecuencia:</b> ${frecuencia || '-'}<br>
        <b>Siguiente fecha:</b> ${siguiente_fecha || '-'}<br>
        <b>Factura adjunta:</b> ${fact_recurrente}<br>
      `;
      const { enviarCorreo } = require('../services/correoService');

      // Correo al admin
      if (adminRows.length > 0) {
        const admin = adminRows[0];
        await enviarCorreo({
          para: admin.email,
          asunto: 'Comprobante subido a plantilla recurrente',
          nombre: admin.nombre,
          link: url,
          mensaje: `Se ha subido un comprobante a la siguiente plantilla recurrente:<br>${detallesRecurrente}`
        });
      }
      // Correo al aprobador (si existe)
      if (id_aprobador && emailAprob) {
        await enviarCorreo({
          para: emailAprob,
          asunto: 'Comprobante subido a plantilla recurrente',
          nombre: nombreAprob,
          link: url,
          mensaje: `Se ha subido un comprobante a la plantilla recurrente que aprobaste:<br>${detallesRecurrente}`
        });
      }
      // Correo al solicitante
      if (emailSolic) {
        await enviarCorreo({
          para: emailSolic,
          asunto: 'Comprobante subido a tu plantilla recurrente',
          nombre: nombreSolic,
          link: url,
          mensaje: `Se ha subido un comprobante a tu plantilla recurrente:<br>${detallesRecurrente}`
        });
      }
    }

    // Enviar notificación de actualización
    await NotificacionService.crearNotificacion({
      id_usuario,
      mensaje: "✏️ Se subió un comprobante a la plantilla recurrente.",
      correo: req.user.email,
    });

    res.json({ message: "Comprobante subido correctamente", fact_recurrente });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Error al subir la factura recurrente" });
  }
};

// Obtener una plantilla recurrente por id
exports.obtenerRecurrentePorId = async (req, res) => {
  try {
    const { id } = req.params;
    const { id_usuario, rol } = req.user;
    const recurrente = await RecurrenteModel.getPorId(id);
    if (!recurrente) return res.status(404).json({ error: "No encontrada" });
    if (rol !== "admin_general" && recurrente.id_usuario !== id_usuario) {
      return res.status(403).json({ error: "No tienes permiso" });
    }
    res.json(recurrente);
  } catch (err) {
    res.status(500).json({ error: "Error al obtener la plantilla" });
  }
};

/* ────────────── Obtener todas las plantillas (admin) ────────────── */
exports.obtenerTodasRecurrentes = async (req, res) => {
  try {
    const recurrentes = await RecurrenteModel.obtenerTodas();
    res.json(recurrentes);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Error al obtener todas las plantillas recurrentes" });
  }
};

// Obtener recurrentes aprobadas (solo pagador)
exports.obtenerAprobadasParaPagador = async (req, res) => {
  try {
    // Solo mostrar las recurrentes aprobadas
    const [rows] = await pool.query(
      `SELECT r.*, u.nombre AS nombre_usuario, a.nombre AS nombre_aprobador, a.id_usuario AS id_aprobador
       FROM pagos_recurrentes r
       JOIN usuarios u ON r.id_usuario = u.id_usuario
       LEFT JOIN usuarios a ON r.id_aprobador = a.id_usuario
       WHERE r.estado = 'aprobada'`
    );
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Error al obtener las recurrentes aprobadas" });
  }
};

// ────────────── Obtener una plantilla recurrente por ID ──────────────
exports.getRecurrentePorId = async (req, res) => {
  try {
    const { id } = req.params;
    const recurrente = await RecurrenteModel.getPorId(id);
    if (!recurrente) {
      return res.status(404).json({ error: 'No se encontró la plantilla recurrente' });
    }
    res.json(recurrente);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al obtener la plantilla recurrente' });
  }
};

exports.subirComprobanteRecurrente = async (req, res) => {
  try {
    const { id } = req.params;
    const { id_usuario, rol } = req.user;
    if (!req.file) return res.status(400).json({ error: 'No se subió ningún archivo' });

    // Validar que la recurrente esté pagada
    const recurrente = await RecurrenteModel.getPorId(id);
    if (!recurrente) return res.status(404).json({ error: 'Plantilla no encontrada' });
    if (recurrente.estado !== 'pagada') {
      return res.status(400).json({ error: 'Solo puedes subir comprobante si la recurrente está pagada' });
    }

    // Guardar ruta en la BD usando el modelo
    const com_recurrente = `/uploads/comprobante-recurrentes/${req.file.filename}`;
    await RecurrenteModel.subirComprobanteRecurrente(id, com_recurrente);

    // Obtener detalles y correos
    const [det] = await pool.query(
      `SELECT r.id_usuario AS idSolicitante,
              us.email AS emailSolic,
              us.nombre AS nombreSolic,
              r.id_aprobador,
              ua.email AS emailAprob,
              ua.nombre AS nombreAprob,
              r.departamento, r.monto, r.cuenta_destino, r.concepto, r.tipo_pago, r.frecuencia, r.siguiente_fecha
       FROM pagos_recurrentes r
       JOIN usuarios us ON us.id_usuario = r.id_usuario
       LEFT JOIN usuarios ua ON ua.id_usuario = r.id_aprobador
       WHERE r.id_recurrente = ?`,
      [id]
    );

    if (det.length) {
      const { idSolicitante, emailSolic, nombreSolic, id_aprobador, emailAprob, nombreAprob, departamento, monto, cuenta_destino, concepto, tipo_pago, frecuencia, siguiente_fecha } = det[0];
      const [adminRows] = await pool.query("SELECT email, nombre FROM usuarios WHERE rol = 'admin_general'");
      const url = 'https://bechapra.com';
      const detallesRecurrente = `
        <b>ID:</b> ${id}<br>
        <b>Departamento:</b> ${departamento}<br>
        <b>Monto:</b> $${monto}<br>
        <b>Cuenta destino:</b> ${cuenta_destino}<br>
        <b>Concepto:</b> ${concepto}<br>
        <b>Tipo de pago:</b> ${tipo_pago || '-'}<br>
        <b>Frecuencia:</b> ${frecuencia || '-'}<br>
        <b>Siguiente fecha:</b> ${siguiente_fecha || '-'}<br>
        <b>Comprobante subido:</b> ${com_recurrente}<br>
      `;
      const { enviarCorreo } = require('../services/correoService');
      if (adminRows.length > 0) {
        const admin = adminRows[0];
        await enviarCorreo({
          para: admin.email,
          asunto: 'Comprobante subido a plantilla recurrente',
          nombre: admin.nombre,
          link: url,
          mensaje: `Se ha subido un comprobante a la siguiente plantilla recurrente:<br>${detallesRecurrente}`
        });
      }
      if (id_aprobador && emailAprob) {
        await enviarCorreo({
          para: emailAprob,
          asunto: 'Comprobante subido a plantilla recurrente',
          nombre: nombreAprob,
          link: url,
          mensaje: `Se ha subido un comprobante a la plantilla recurrente que aprobaste:<br>${detallesRecurrente}`
        });
      }
      if (emailSolic) {
        await enviarCorreo({
          para: emailSolic,
          asunto: 'Comprobante subido a tu plantilla recurrente',
          nombre: nombreSolic,
          link: url,
          mensaje: `Se ha subido un comprobante a tu plantilla recurrente:<br>${detallesRecurrente}`
        });
      }
    }

    await NotificacionService.crearNotificacion({
      id_usuario,
      mensaje: "💾 Se subió un comprobante a la plantilla recurrente.",
      correo: req.user.email,
    });

    res.json({ message: "Comprobante subido correctamente", com_recurrente });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Error al subir comprobante recurrente" });
  }
};

/* ────────────── Obtener comprobantes de una plantilla recurrente ────────────── */
exports.obtenerComprobantesRecurrente = async (req, res) => {
  try {
    const { id } = req.params;
    
    console.log('🔍 Buscando comprobantes para recurrente ID:', id);
    
    // Verificar que la plantilla existe
    const recurrente = await RecurrenteModel.getPorId(id);
    if (!recurrente) {
      return res.status(404).json({ error: 'Plantilla recurrente no encontrada' });
    }

    console.log('🔍 Plantilla encontrada, buscando comprobantes...');

    // Obtener comprobantes de la plantilla recurrente
    let comprobantes = [];
    
    try {
      const [result] = await pool.query(
        `SELECT 
          id_recurrente as id,
          com_recurrente as con_recurrente,
          fecha_pago,
          COALESCE(id_pagador, 'Sistema') as usuario_pago,
          CASE 
            WHEN estado = 'pagada' THEN 'Comprobante de pago procesado'
            ELSE 'Comprobante disponible'
          END as comentario
         FROM pagos_recurrentes 
         WHERE id_recurrente = ? 
         AND com_recurrente IS NOT NULL
         AND com_recurrente != ''
         ORDER BY fecha_pago DESC`,
        [id]
      );
      comprobantes = result;
      console.log('✅ Comprobantes encontrados:', comprobantes.length);
    } catch (error) {
      console.log('❌ Error al obtener comprobantes:', error.message);
      comprobantes = [];
    }

    console.log('🔍 Comprobantes finales a enviar:', comprobantes);
    res.json(comprobantes);
  } catch (err) {
    console.error('❌ Error general al obtener comprobantes:', err);
    res.status(500).json({ error: "Error al obtener comprobantes de la plantilla recurrente", details: err.message });
  }
};

