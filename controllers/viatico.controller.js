const ViaticoModel = require("../models/viatico.model");
const NotificacionService = require("../services/notificacionesService");
const pool = require("../db/connection");
const Joi = require('joi');
const { registrarAccion } = require('../services/accionLogger');

exports.getViaticos = async (req, res) => {
  try {
    const { rol, id_usuario } = req.user;
    const { estado } = req.query; // Obtener el parámetro estado de la query
    let viaticos = [];
    
    // Si se especifica estado=pagado, obtener viáticos pagados
    if (estado === 'pagado') {
      viaticos = await ViaticoModel.getPagados();
    } else if (rol === "solicitante") {
      viaticos = await ViaticoModel.getPorUsuario(id_usuario);
    } else if (rol === "pagador_banca") {
      viaticos = await ViaticoModel.getAutorizadas();
    } else {
      viaticos = await ViaticoModel.getTodas();
    }
    res.json(viaticos);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Error al obtener viáticos" });
  }
};

exports.getViatico = async (req, res) => {
  try {
    const { rol, id_usuario } = req.user;
    const { id } = req.params;
    const viatico = await ViaticoModel.getPorId(id);
    if (!viatico) {
      return res.status(404).json({ error: "Viático no encontrado" });
    }
    if (rol === "solicitante" && viatico.id_usuario !== id_usuario) {
      return res.status(403).json({ error: "No tienes permiso para ver este viático" });
    }
    res.json(viatico);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Error al obtener el viático" });
  }
};

exports.createViatico = async (req, res) => {
  try {
    console.log('📝 Creando viático...');
    console.log('📝 Headers:', req.headers);
    console.log('📝 Body recibido:', req.body);
    console.log('📝 Archivo recibido:', req.file);
    console.log('📝 Usuario:', req.user);

    // Asegurar que req.body sea un objeto
    if (!req.body || typeof req.body !== 'object') {
      console.log('❌ req.body no es un objeto:', req.body);
      req.body = {};
    }

    // Si se sube archivo, asignar la ruta a viatico_url y eliminar viatico_url de req.body para evitar conflicto de tipos
    if (req.file) {
      console.log('📁 Archivo subido:', req.file.filename);
      req.body.viatico_url = `/uploads/viaticos/${req.file.filename}`;
    } else {
      console.log('⚠️ No se recibió archivo');
      // Si no hay archivo, asegurar que viatico_url sea string vacía o null
      req.body.viatico_url = req.body.viatico_url || '';
    }

    // Forzar el id_usuario autenticado
    req.body.id_usuario = req.user ? req.user.id_usuario : undefined;
    console.log('👤 ID Usuario asignado:', req.body.id_usuario);
    const schema = Joi.object({
      id_usuario: Joi.number().required(),
      departamento: Joi.string().required(),
      monto: Joi.number().positive().required(),
      cuenta_destino: Joi.string().required(),
      concepto: Joi.string().required(),
      tipo_pago: Joi.string().valid('viaticos').required(),
      fecha_limite_pago: Joi.date().required(),
      tipo_cuenta_destino: Joi.string().default('CLABE'),
      tipo_tarjeta: Joi.string().allow(null, ''),
      banco_destino: Joi.string().allow(null, ''),
      viatico_url: Joi.string().allow(null, ''),
      estado: Joi.string().valid('pendiente','autorizada','rechazada','pagada').default('pendiente'),
      comentario_aprobador: Joi.string().allow(null, ''),
      id_aprobador: Joi.number().allow(null),
      id_pagador: Joi.number().allow(null),
      fecha_revision: Joi.date().allow(null),
      fecha_pago: Joi.date().allow(null),
      folio: Joi.string().allow(null, ''),
      tipo_pago_descripcion: Joi.string().allow(null, ''),
      empresa_a_pagar: Joi.string().allow(null, ''),
      nombre_persona: Joi.string().required(),
    });
    console.log('🔍 Validando datos con schema:', req.body);
    const datos = await schema.validateAsync(req.body, { convert: true });
    console.log('✅ Datos validados:', datos);

    console.log('💾 Creando viático en la base de datos...');
    const viatico = await ViaticoModel.crear(datos);
    console.log('✅ Viático creado:', viatico);

    if (!req.user) {
      console.error('❌ No hay usuario autenticado en la petición');
      return res.status(401).json({ error: 'Usuario no autenticado' });
    }

    console.log('📝 Registrando acción...');
    await registrarAccion({ 
      req, 
      accion: 'creó', 
      entidad: 'viático', 
      entidadId: viatico.id_viatico,
      detalles: `Folio: ${viatico.folio}, Monto: $${viatico.monto?.toLocaleString() || 'N/A'}`
    });
    console.log('✅ Acción registrada');

    console.log('🎉 Viático creado exitosamente');
    res.status(201).json(viatico);
  } catch (err) {
    console.error('❌ Error al crear viático:', err);
    console.error('❌ Detalles del error:', {
      message: err.message,
      name: err.name,
      stack: err.stack,
      details: err.details // Para errores de Joi
    });
    res.status(400).json({ 
      error: err.message,
      details: err.details // Incluir detalles de validación si es un error de Joi
    });
  }

};

// Editar viático (igual que solicitudes)
exports.editarViatico = async (req, res) => {
  try {
    const { id } = req.params;
    const { rol, id_usuario } = req.user;
    const esAdminGeneral = rol === "admin_general";
    // Si hay archivo, agregar viatico_url
    let viatico_url = null;
    if (req.file) {
      viatico_url = `/uploads/viaticos/${req.file.filename}`;
    }
    // Tomar todos los campos permitidos
    const {
      departamento,
      monto,
      cuenta_destino,
      concepto,
      tipo_pago,
      fecha_limite_pago,
      tipo_cuenta_destino,
      tipo_tarjeta,
      banco_destino,
      tipo_pago_descripcion,
      empresa_a_pagar,
      nombre_persona
    } = req.body;
    const datos = {
      departamento,
      monto,
      cuenta_destino,
      concepto,
      tipo_pago,
      fecha_limite_pago,
      tipo_cuenta_destino,
      tipo_tarjeta,
      banco_destino,
      tipo_pago_descripcion,
      empresa_a_pagar,
      nombre_persona
    };
    // Solo incluir viatico_url si hay archivo nuevo
    if (viatico_url) {
      datos.viatico_url = viatico_url;
    }
    const filas = await ViaticoModel.editarViaticoSiPendiente(
      id,
      id_usuario,
      datos,
      esAdminGeneral
    );
    if (filas === 0) {
      return res.status(400).json({
        error: "No se puede editar: El viático no está pendiente o no tienes permiso.",
      });
    }
    await registrarAccion({ req, accion: 'editar', entidad: 'viatico', entidadId: id });
    res.json({ message: "Viático editado correctamente" });
  } catch (err) {
    console.error(err);
    res.status(400).json({ error: err.message });
  }
};

exports.actualizarViaticoConArchivo = async (req, res) => {
  try {
    const { id } = req.params;
    const { rol, id_usuario } = req.user;
    const esAdminGeneral = rol === "admin_general";
    
    console.log('📝 Actualizando viático con archivo...');
    console.log('📝 ID:', id);
    console.log('📝 Body recibido:', req.body);
    console.log('📝 Archivo recibido:', req.file);
    
    // Verificar si hay archivo
    let viatico_url = null;
    if (req.file) {
      viatico_url = `/uploads/viaticos/${req.file.filename}`;
    }
    
    // Tomar todos los campos permitidos del cuerpo
    const {
      departamento,
      monto,
      cuenta_destino,
      concepto,
      tipo_pago,
      fecha_limite_pago,
      tipo_cuenta_destino,
      tipo_tarjeta,
      banco_destino,
      tipo_pago_descripcion,
      empresa_a_pagar,
      nombre_persona
    } = req.body;
    
    const datos = {
      departamento,
      monto,
      cuenta_destino,
      concepto,
      tipo_pago: tipo_pago || "viaticos",
      fecha_limite_pago,
      tipo_cuenta_destino,
      tipo_tarjeta,
      banco_destino,
      tipo_pago_descripcion,
      empresa_a_pagar,
      nombre_persona
    };
    
    // Solo incluir viatico_url si hay archivo nuevo
    if (viatico_url) {
      datos.viatico_url = viatico_url;
    }
    
    const filas = await ViaticoModel.editarViaticoSiPendiente(
      id,
      id_usuario,
      datos,
      esAdminGeneral
    );
    
    if (filas === 0) {
      return res.status(400).json({
        error: "No se puede actualizar: El viático no está pendiente o no tienes permiso.",
      });
    }
    
    // Obtener el viático actualizado para devolverlo
    const viaticoActualizado = await ViaticoModel.getPorId(id);
    
    await registrarAccion({ req, accion: 'actualizar_archivo', entidad: 'viatico', entidadId: id });
    
    res.json(viaticoActualizado);
  } catch (err) {
    console.error('Error al actualizar viático con archivo:', err);
    res.status(400).json({ error: err.message });
  }
};

exports.eliminarViatico = async (req, res) => {
  try {
    const { id } = req.params;
    const { rol, id_usuario } = req.user;
    const viatico = await ViaticoModel.getPorId(id);
    if (!viatico) {
      return res.status(404).json({ error: "Viático no encontrado" });
    }
    // Si es solicitante, solo puede eliminar si es suyo y está pendiente
    if (rol === "solicitante") {
      if (viatico.id_usuario !== id_usuario) {
        return res.status(403).json({ error: "No tienes permiso para eliminar este viático" });
      }
      if (String(viatico.estado).toLowerCase() !== "pendiente") {
        return res.status(403).json({ error: "Solo puedes eliminar viáticos en estado pendiente" });
      }
    }
    await ViaticoModel.eliminar(id);
    await registrarAccion({ req, accion: 'eliminar', entidad: 'viatico', entidadId: id });
    res.json({ message: "Viático eliminado" });
  } catch (err) {
    console.error(err);
    res.status(400).json({ error: err.message });
  }
};

// Subir archivo de viático y actualizar viatico_url
exports.subirArchivoViatico = async (req, res) => {
  try {
    const { id_viatico } = req.body;
    if (!req.file || !id_viatico) {
      return res.status(400).json({ error: "Archivo y id_viatico requeridos" });
    }
    const ruta = `/uploads/viaticos/${req.file.filename}`;
    await ViaticoModel.actualizar(id_viatico, { viatico_url: ruta });
    await registrarAccion({ req, accion: 'subir', entidad: 'viatico', entidadId: id_viatico });
    res.json({ message: "Archivo subido", viatico_url: ruta });
  } catch (err) {
    console.error(err);
    res.status(400).json({ error: err.message });
  }
};

// Aprobar viático individual
exports.aprobarViatico = async (req, res) => {
  try {
    const { id } = req.params;
    const { id_usuario: id_aprobador } = req.user;
    const { comentario_aprobador = '' } = req.body;
    const filas = await ViaticoModel.actualizarEstado(id, 'autorizada', comentario_aprobador, id_aprobador);
    if (filas === 0) {
      return res.status(400).json({ error: 'No se puede aprobar: El viático no está pendiente o no existe.' });
    }
    // Notificar al solicitante
    const viatico = await ViaticoModel.getPorId(id);
    if (viatico && viatico.id_usuario) {
      await NotificacionService.crearNotificacion({
        id_usuario: viatico.id_usuario,
        mensaje: `✅ Tu viático folio ${viatico.folio} por $${viatico.monto?.toLocaleString() || 'N/A'} fue aprobado por ${req.user.nombre || 'Aprobador'}`,
        enviarWebSocket: true
      });
    }
    await registrarAccion({ 
      req, 
      accion: 'aprobó', 
      entidad: 'viático', 
      entidadId: id, 
      detalles: `Folio: ${viatico?.folio}, Monto: $${viatico?.monto?.toLocaleString() || 'N/A'}` 
    });
    res.json({ message: 'Viático aprobado correctamente' });
  } catch (err) {
    console.error(err);
    res.status(400).json({ error: err.message });
  }
};

// Rechazar viático individual
exports.rechazarViatico = async (req, res) => {
  try {
    const { id } = req.params;
    const { id_usuario: id_aprobador } = req.user;
    const { comentario_aprobador = '' } = req.body;
    const filas = await ViaticoModel.actualizarEstado(id, 'rechazada', comentario_aprobador, id_aprobador);
    if (filas === 0) {
      return res.status(400).json({ error: 'No se puede rechazar: El viático no está pendiente o no existe.' });
    }
    // Notificar al solicitante
    const viatico = await ViaticoModel.getPorId(id);
    if (viatico && viatico.id_usuario) {
      await NotificacionService.crearNotificacion({
        id_usuario: viatico.id_usuario,
        mensaje: `❌ Tu viático folio ${viatico.folio} por $${viatico.monto?.toLocaleString() || 'N/A'} fue rechazado por ${req.user.nombre || 'Aprobador'}`,
        enviarWebSocket: true
      });
    }
    await registrarAccion({ 
      req, 
      accion: 'rechazó', 
      entidad: 'viático', 
      entidadId: id, 
      detalles: `Folio: ${viatico?.folio}, Monto: $${viatico?.monto?.toLocaleString() || 'N/A'}` 
    });
    res.json({ message: 'Viático rechazado correctamente' });
  } catch (err) {
    console.error(err);
    res.status(400).json({ error: err.message });
  }
};

// Aprobar viáticos en lote
exports.aprobarLoteViaticos = async (req, res) => {
  try {
    const { ids = [], comentario_aprobador = '' } = req.body;
    const { id_usuario: id_aprobador } = req.user;
    if (!Array.isArray(ids) || !ids.length) {
      return res.status(400).json({ error: 'Debes enviar un arreglo de IDs' });
    }
    const filas = await ViaticoModel.aprobarLote(ids, id_aprobador, comentario_aprobador);
    // Notificar a los solicitantes de los viáticos aprobados
    for (const id of ids) {
      const viatico = await ViaticoModel.getPorId(id);
      if (viatico && viatico.id_usuario) {
        await NotificacionService.crearNotificacion({
          id_usuario: viatico.id_usuario,
          mensaje: `✅ Tu viático folio ${viatico.folio} por $${viatico.monto?.toLocaleString() || 'N/A'} fue aprobado por ${req.user.nombre || 'Aprobador'}`,
          enviarWebSocket: true
        });
      }
    }
    await registrarAccion({ 
      req, 
      accion: 'aprobó en lote', 
      entidad: 'viáticos', 
      entidadId: ids.join(','), 
      detalles: `${ids.length} viáticos aprobados` 
    });
    res.json({ message: `Se aprobaron ${filas} viáticos` });
  } catch (err) {
    console.error(err);
    res.status(400).json({ error: err.message });
  }
};

// Rechazar viáticos en lote
exports.rechazarLoteViaticos = async (req, res) => {
  try {
    const { ids = [], comentario_aprobador = '' } = req.body;
    const { id_usuario: id_aprobador } = req.user;
    if (!Array.isArray(ids) || !ids.length) {
      return res.status(400).json({ error: 'Debes enviar un arreglo de IDs' });
    }
    const filas = await ViaticoModel.rechazarLote(ids, id_aprobador, comentario_aprobador);
    // Notificar a los solicitantes de los viáticos rechazados
    for (const id of ids) {
      const viatico = await ViaticoModel.getPorId(id);
      if (viatico && viatico.id_usuario) {
        await NotificacionService.crearNotificacion({
          id_usuario: viatico.id_usuario,
          mensaje: `❌ Tu viático folio ${viatico.folio} por $${viatico.monto?.toLocaleString() || 'N/A'} fue rechazado por ${req.user.nombre || 'Aprobador'}`,
          enviarWebSocket: true
        });
      }
    }
    await registrarAccion({ 
      req, 
      accion: 'rechazó en lote', 
      entidad: 'viáticos', 
      entidadId: ids.join(','), 
      detalles: `${ids.length} viáticos rechazados` 
    });
    res.json({ message: `Se rechazaron ${filas} viáticos` });
  } catch (err) {
    console.error(err);
    res.status(400).json({ error: err.message });
  }
};

// ──────────────── Marcar viático como pagado (pagador) ────────────────
exports.marcarComoPagado = async (req, res) => {
  try {
    const { id } = req.params;
    const { rol, id_usuario: id_pagador } = req.user;
    if (rol !== "pagador_banca") {
      return res.status(403).json({ error: "No tienes permisos para marcar el viático como pagado" });
    }
    const filas = await ViaticoModel.marcarComoPagado(id, id_pagador);
    if (filas === 0) {
      // Verifica el estado actual en BD para debug
      const [rows] = await pool.query(
        `SELECT estado FROM solicitudes_viaticos WHERE id_viatico = ?`,
        [id]
      );
      const estadoActual = rows[0]?.estado;
      return res.status(404).json({ error: `No se pudo marcar como pagado. Estado actual: ${estadoActual}` });
    }
    await registrarAccion({ 
      req, 
      accion: 'pagó', 
      entidad: 'viático', 
      entidadId: id,
      detalles: `Viático marcado como pagado`
    });
    res.json({ message: "Viático marcado como pagado" });
  } catch (err) {
    console.error(err);
    res.status(400).json({ error: err.message });
  }
};