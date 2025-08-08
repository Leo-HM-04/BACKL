/* ──────────────────────────────────────────────────────────────
   Controlador de Usuarios - Funciones Mejoradas
   Ejemplos de notificaciones específicas para gestión de usuarios
   ────────────────────────────────────────────────────────────── */

const bcrypt = require("bcrypt");
const Usuario = require("../models/usuario.model");
const NotificacionServiceMejorado = require("../services/notificacionesServiceMejorado");
const { registrarAccion } = require('../services/accionLogger');

/**
 * Crear usuario con notificaciones mejoradas
 */
const createUsuarioMejorado = async (req, res) => {
  try {
    const Joi = require('joi');
    
    // Validación robusta con Joi
    const schema = Joi.object({
      nombre: Joi.string().min(3).max(100).required(),
      email: Joi.string().email().required(),
      password: Joi.string().min(8).max(100).required(),
      rol: Joi.string().valid('admin_general', 'solicitante', 'aprobador', 'pagador_banca').required(),
      departamento: Joi.string().max(100).optional()
    });
    
    const { error, value } = schema.validate(req.body);
    if (error) {
      return res.status(400).json({ message: 'Datos inválidos', details: error.details });
    }
    
    const { nombre, email, password, rol, departamento } = value;

    // Validar si el correo ya existe
    const usuarioExistente = await Usuario.getUsuarioByEmail(email);
    if (usuarioExistente) {
      return res.status(409).json({ message: "Ya existe un usuario con ese email" });
    }

    // Validar que solo pueda haber un admin_general
    if (rol === 'admin_general') {
      const adminExistente = await Usuario.getUsuarioByRol('admin_general');
      if (adminExistente) {
        return res.status(409).json({ message: "Ya existe un administrador general en el sistema" });
      }
    }

    // Hashear password
    const hashedPassword = await bcrypt.hash(password, 10);

    // Crear usuario
    const nuevoUsuario = await Usuario.createUsuario({
      nombre,
      email,
      password: hashedPassword,
      rol,
      departamento
    });

    const usuarioId = nuevoUsuario.insertId || nuevoUsuario.id_usuario;

    // Preparar detalles para notificaciones
    const detallesUsuario = {
      usuario_nombre: nombre,
      usuario_email: email,
      usuario_rol: rol,
      usuario_departamento: departamento || 'Sin asignar',
      fecha_creacion: new Date().toLocaleDateString('es-MX'),
      creado_por: req.user.nombre
    };

    // 1. Notificar al nuevo usuario (bienvenida)
    await NotificacionServiceMejorado.crearNotificacionMejorada({
      tipo: NotificacionServiceMejorado.TIPOS_NOTIFICACION.USUARIO_BIENVENIDA,
      id_usuario_emisor: req.user.id_usuario,
      id_usuario_destinatario: usuarioId,
      entidad: 'usuario',
      entidad_id: usuarioId,
      detalles: detallesUsuario,
      enviarWebSocket: true,
      enviarCorreo: true
    });

    // 2. Notificar al admin general (si no es él quien lo crea)
    if (req.user.rol !== 'admin_general') {
      await NotificacionServiceMejorado.crearNotificacionMejorada({
        tipo: NotificacionServiceMejorado.TIPOS_NOTIFICACION.USUARIO_CREADO,
        id_usuario_emisor: req.user.id_usuario,
        destinatarios_rol: 'admin_general',
        entidad: 'usuario',
        entidad_id: usuarioId,
        detalles: detallesUsuario,
        enviarWebSocket: true,
        enviarCorreo: true
      });
    } else {
      // Si es el admin quien lo crea, notificar a otros admins (si los hay)
      await NotificacionServiceMejorado.crearNotificacionMejorada({
        tipo: NotificacionServiceMejorado.TIPOS_NOTIFICACION.USUARIO_CREADO,
        id_usuario_emisor: req.user.id_usuario,
        destinatarios_rol: 'admin_general',
        entidad: 'usuario',
        entidad_id: usuarioId,
        detalles: detallesUsuario,
        enviarWebSocket: true,
        enviarCorreo: false
      });
    }

    // 3. Notificar a aprobadores si se creó un nuevo solicitante
    if (rol === 'solicitante') {
      await NotificacionServiceMejorado.crearNotificacionMejorada({
        tipo: NotificacionServiceMejorado.TIPOS_NOTIFICACION.USUARIO_CREADO,
        id_usuario_emisor: req.user.id_usuario,
        destinatarios_rol: 'aprobador',
        entidad: 'usuario',
        entidad_id: usuarioId,
        detalles: {
          ...detallesUsuario,
          mensaje_aprobador: `Se agregó un nuevo solicitante: ${nombre} del departamento ${departamento || 'Sin especificar'}`
        },
        enviarWebSocket: true,
        enviarCorreo: false
      });
    }

    // 4. Notificar a pagadores si se creó un nuevo aprobador
    if (rol === 'aprobador') {
      await NotificacionServiceMejorado.crearNotificacionMejorada({
        tipo: NotificacionServiceMejorado.TIPOS_NOTIFICACION.USUARIO_CREADO,
        id_usuario_emisor: req.user.id_usuario,
        destinatarios_rol: 'pagador_banca',
        entidad: 'usuario',
        entidad_id: usuarioId,
        detalles: {
          ...detallesUsuario,
          mensaje_pagador: `Se agregó un nuevo aprobador: ${nombre}. Las solicitudes que apruebe llegarán para pago.`
        },
        enviarWebSocket: true,
        enviarCorreo: false
      });
    }

    // Registrar la acción
    await registrarAccion({
      req,
      accion: 'creó_usuario',
      entidad: 'usuario',
      entidadId: usuarioId,
      detalles: detallesUsuario
    });

    // Enviar correo de bienvenida
    const { enviarCorreo } = require('../services/correoService');
    const url = 'https://bechapra.com';
    await enviarCorreo({
      para: email,
      asunto: '¡Bienvenido a Bechapra!',
      nombre: nombre,
      link: url,
      mensaje: `¡Hola ${nombre}!<br>Tu cuenta ha sido creada exitosamente.<br><strong>Rol:</strong> ${rol}<br><strong>Departamento:</strong> ${departamento || 'Sin asignar'}<br>Accede a la plataforma y comienza a gestionar tus solicitudes.`
    });

    res.status(201).json({ 
      message: "Usuario creado exitosamente",
      usuario: {
        id: usuarioId,
        nombre,
        email,
        rol,
        departamento,
        created_at: new Date()
      }
    });
  } catch (error) {
    console.error("Error en createUsuarioMejorado:", error);
    res.status(500).json({ message: "Error al crear usuario" });
  }
};

/**
 * Actualizar usuario con notificaciones específicas
 */
const updateUsuarioMejorado = async (req, res) => {
  try {
    const { id } = req.params;
    const { nombre, email, rol, departamento, activo } = req.body;

    // Obtener datos actuales del usuario
    const usuarioAnterior = await Usuario.getUsuarioById(id);
    if (!usuarioAnterior) {
      return res.status(404).json({ message: "Usuario no encontrado" });
    }

    // Actualizar usuario
    await Usuario.updateUsuario(id, { nombre, email, rol, departamento, activo });

    // Preparar detalles de los cambios
    const cambios = {};
    if (usuarioAnterior.nombre !== nombre) cambios.nombre = { anterior: usuarioAnterior.nombre, nuevo: nombre };
    if (usuarioAnterior.email !== email) cambios.email = { anterior: usuarioAnterior.email, nuevo: email };
    if (usuarioAnterior.rol !== rol) cambios.rol = { anterior: usuarioAnterior.rol, nuevo: rol };
    if (usuarioAnterior.departamento !== departamento) cambios.departamento = { anterior: usuarioAnterior.departamento, nuevo: departamento };
    if (usuarioAnterior.activo !== activo) cambios.estado = { anterior: usuarioAnterior.activo ? 'Activo' : 'Inactivo', nuevo: activo ? 'Activo' : 'Inactivo' };

    const detallesActualizacion = {
      usuario_nombre: nombre,
      usuario_email: email,
      usuario_rol: rol,
      usuario_departamento: departamento,
      cambios_realizados: cambios,
      actualizado_por: req.user.nombre,
      fecha_actualizacion: new Date().toLocaleDateString('es-MX'),
      cambios_importantes: Object.keys(cambios).length > 0
    };

    // 1. Notificar al usuario actualizado (si no se desactivó)
    if (activo !== false) {
      await NotificacionServiceMejorado.crearNotificacionMejorada({
        tipo: NotificacionServiceMejorado.TIPOS_NOTIFICACION.USUARIO_ACTUALIZADO,
        id_usuario_emisor: req.user.id_usuario,
        id_usuario_destinatario: parseInt(id),
        entidad: 'usuario',
        entidad_id: parseInt(id),
        detalles: detallesActualizacion,
        enviarWebSocket: true,
        enviarCorreo: Object.keys(cambios).length > 0
      });
    }

    // 2. Notificar al admin general
    await NotificacionServiceMejorado.crearNotificacionMejorada({
      tipo: NotificacionServiceMejorado.TIPOS_NOTIFICACION.USUARIO_ACTUALIZADO,
      id_usuario_emisor: req.user.id_usuario,
      destinatarios_rol: 'admin_general',
      entidad: 'usuario',
      entidad_id: parseInt(id),
      detalles: detallesActualizacion,
      enviarWebSocket: true,
      enviarCorreo: cambios.rol || cambios.estado || Object.keys(cambios).length >= 3
    });

    // 3. Notificar a roles específicos si hay cambios importantes
    if (cambios.rol) {
      // Si cambió el rol, notificar a los miembros del nuevo rol
      if (rol === 'aprobador') {
        await NotificacionServiceMejorado.crearNotificacionMejorada({
          tipo: NotificacionServiceMejorado.TIPOS_NOTIFICACION.USUARIO_ACTUALIZADO,
          id_usuario_emisor: req.user.id_usuario,
          destinatarios_rol: 'aprobador',
          entidad: 'usuario',
          entidad_id: parseInt(id),
          detalles: {
            ...detallesActualizacion,
            mensaje_especial: `${nombre} se unió al equipo de aprobadores`
          },
          enviarWebSocket: true,
          enviarCorreo: false
        });
      }
    }

    // Registrar la acción
    await registrarAccion({
      req,
      accion: 'actualizó_usuario',
      entidad: 'usuario',
      entidadId: id,
      detalles: detallesActualizacion
    });

    res.json({ 
      message: "Usuario actualizado exitosamente",
      cambios: Object.keys(cambios),
      usuario: {
        id: parseInt(id),
        nombre,
        email,
        rol,
        departamento,
        activo
      }
    });
  } catch (error) {
    console.error("Error en updateUsuarioMejorado:", error);
    res.status(500).json({ message: "Error al actualizar usuario" });
  }
};

/**
 * Eliminar usuario con notificaciones de seguridad
 */
const deleteUsuarioMejorado = async (req, res) => {
  try {
    const { id } = req.params;
    
    // Verificar que no se trate del único admin
    const usuario = await Usuario.getUsuarioById(id);
    if (!usuario) {
      return res.status(404).json({ message: "Usuario no encontrado" });
    }

    if (usuario.rol === 'admin_general') {
      const admins = await Usuario.getUsuariosByRol('admin_general');
      if (admins.length <= 1) {
        return res.status(400).json({ 
          message: "No se puede eliminar el único administrador del sistema" 
        });
      }
    }

    // Verificar que no se auto-elimine
    if (parseInt(id) === req.user.id_usuario) {
      return res.status(400).json({ 
        message: "No puedes eliminar tu propia cuenta" 
      });
    }

    const detallesEliminacion = {
      usuario_eliminado: usuario.nombre,
      email_eliminado: usuario.email,
      rol_eliminado: usuario.rol,
      departamento_eliminado: usuario.departamento,
      eliminado_por: req.user.nombre,
      fecha_eliminacion: new Date().toLocaleDateString('es-MX'),
      motivo: req.body.motivo || 'No especificado'
    };

    // Eliminar usuario
    await Usuario.deleteUsuario(id);

    // 1. Notificar a todos los administradores (alta prioridad)
    await NotificacionServiceMejorado.crearNotificacionMejorada({
      tipo: NotificacionServiceMejorado.TIPOS_NOTIFICACION.USUARIO_ELIMINADO,
      id_usuario_emisor: req.user.id_usuario,
      destinatarios_rol: 'admin_general',
      entidad: 'usuario',
      entidad_id: parseInt(id),
      detalles: detallesEliminacion,
      enviarWebSocket: true,
      enviarCorreo: true // Siempre enviar correo para eliminaciones
    });

    // 2. Notificar a roles relacionados según el rol eliminado
    if (usuario.rol === 'aprobador') {
      // Si se eliminó un aprobador, notificar a otros aprobadores
      await NotificacionServiceMejorado.crearNotificacionMejorada({
        tipo: NotificacionServiceMejorado.TIPOS_NOTIFICACION.USUARIO_ELIMINADO,
        id_usuario_emisor: req.user.id_usuario,
        destinatarios_rol: 'aprobador',
        entidad: 'usuario',
        entidad_id: parseInt(id),
        detalles: {
          ...detallesEliminacion,
          mensaje_aprobadores: `Se eliminó el aprobador ${usuario.nombre}. Las solicitudes pendientes pueden necesitar reasignación.`
        },
        enviarWebSocket: true,
        enviarCorreo: false
      });
    }

    if (usuario.rol === 'pagador_banca') {
      // Si se eliminó un pagador, notificar a otros pagadores
      await NotificacionServiceMejorado.crearNotificacionMejorada({
        tipo: NotificacionServiceMejorado.TIPOS_NOTIFICACION.USUARIO_ELIMINADO,
        id_usuario_emisor: req.user.id_usuario,
        destinatarios_rol: 'pagador_banca',
        entidad: 'usuario',
        entidad_id: parseInt(id),
        detalles: {
          ...detallesEliminacion,
          mensaje_pagadores: `Se eliminó el pagador ${usuario.nombre}. Verificar reasignación de pagos pendientes.`
        },
        enviarWebSocket: true,
        enviarCorreo: false
      });
    }

    // Registrar la acción (alta prioridad)
    await registrarAccion({
      req,
      accion: 'eliminó_usuario',
      entidad: 'usuario',
      entidadId: id,
      detalles: detallesEliminacion
    });

    res.json({ 
      message: "Usuario eliminado exitosamente",
      usuario_eliminado: {
        nombre: usuario.nombre,
        email: usuario.email,
        rol: usuario.rol
      }
    });
  } catch (error) {
    console.error("Error en deleteUsuarioMejorado:", error);
    res.status(500).json({ message: "Error al eliminar usuario" });
  }
};

module.exports = {
  createUsuarioMejorado,
  updateUsuarioMejorado,
  deleteUsuarioMejorado
};
