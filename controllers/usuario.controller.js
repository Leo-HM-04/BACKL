const bcrypt = require("bcrypt");
const Usuario = require("../models/usuario.model");

// Obtener todos los usuarios
const getUsuarios = async (req, res) => {
  try {
    const usuarios = await Usuario.getAllUsuarios();
    res.json(usuarios);
  } catch (error) {
    console.error("Error en getUsuarios:", error);
    res.status(500).json({ message: "Error al obtener usuarios" });
  }
};

// Obtener un usuario por ID
const getUsuario = async (req, res) => {
  try {
    const usuario = await Usuario.getUsuarioById(req.params.id);
    if (!usuario) return res.status(404).json({ message: "Usuario no encontrado" });
    res.json(usuario);
  } catch (error) {
    console.error("Error en getUsuario:", error);
    res.status(500).json({ message: "Error al obtener el usuario" });
  }
};


// Crear un nuevo usuario (con validación de duplicado y de admin único)
const Joi = require('joi');
const { registrarAccion } = require('../services/accionLogger');

const createUsuario = async (req, res) => {
  try {
    // Validación robusta con Joi (acepta cualquier dominio de email)
    const schema = Joi.object({
      nombre: Joi.string().min(3).max(100).required(),
      email: Joi.string().email().required(),
      password: Joi.string().min(8).max(100).required(),
      rol: Joi.string().valid('admin_general', 'solicitante', 'aprobador', 'pagador_banca').required(),
    });
    const { error, value } = schema.validate(req.body);
    if (error) {
      return res.status(400).json({ message: 'Datos inválidos', details: error.details });
    }
    const { nombre, email, password, rol } = value;

    // Validar si el correo ya existe
    const usuarioExistente = await Usuario.getUsuarioByEmail(email);
    if (usuarioExistente) {
      return res.status(409).json({ message: "Ya existe un usuario con ese email" });
    }
    // Validar si ya existe un admin_general (solo puede haber uno)
    if (rol === "admin_general") {
      const adminYaExiste = await Usuario.getUsuarioByRol("admin_general");
      if (adminYaExiste) {
        return res.status(409).json({ message: "Ya existe un usuario con rol admin_general; solo puede haber un administador" });
      }
    }
    // Encriptar la contraseña
    const hashedPassword = await bcrypt.hash(password, 10);
    // Crear usuario (sin token de verificación, marcado como verificado)
    const id = await Usuario.createUsuario(nombre, email, hashedPassword, rol, null, true);

    // Enviar correo de bienvenida profesional al usuario creado
    const { enviarCorreo } = require('../services/correoService');
    const url = 'https://bechapra.com'; // Cambia por la URL real de la plataforma si es necesario
    await enviarCorreo({
      para: email,
      asunto: '¡Bienvenido/a a la plataforma Bechapra!',
      nombre,
      link: url,
      mensaje: `¡Hola ${nombre}!<br>Tu cuenta ha sido creada exitosamente.<br>Accede a la plataforma y comienza a gestionar tus solicitudes.`
    });

    // Notificación persistente de bienvenida al usuario creado
    const NotificacionService = require('../services/notificacionesService');
    await NotificacionService.crearNotificacion({
      id_usuario: id,
      mensaje: `🎉 ¡Bienvenido/a ${nombre}! Tu cuenta ${rol} ha sido creada exitosamente en Bechapra.`,
      enviarCorreo: false
    });

    // Buscar admin_general para notificarle
    const pool = require('../db/connection');
    const [admins] = await pool.query("SELECT id_usuario, email, nombre FROM usuarios WHERE rol = 'admin_general'");
    if (admins.length > 0) {
      const admin = admins[0];
      // Notificación persistente al admin
      await NotificacionService.crearNotificacion({
        id_usuario: admin.id_usuario,
        mensaje: `👤 Nuevo usuario ${rol} creado: ${nombre} (${email}) por ${req.user?.nombre || 'Admin'}`,
        enviarCorreo: true,
        correo: admin.email
      });
      // Correo profesional al admin con detalles
      await enviarCorreo({
        para: admin.email,
        asunto: 'Nuevo usuario creado en Bechapra',
        nombre: admin.nombre,
        link: url,
        mensaje: `Se ha creado un nuevo usuario en la plataforma:<br><b>Nombre:</b> ${nombre}<br><b>Email:</b> ${email}<br><b>Rol:</b> ${rol}`
      });
    }

    // Registrar acción
    await registrarAccion({
      req,
      accion: 'creó',
      entidad: 'usuario',
      entidadId: id,
      detalles: `${rol}: ${nombre} (${email})`,
      mensajeExtra: `Usuario creado exitosamente`
    });

    res.status(201).json({ id, nombre, email, rol, mensaje: 'Usuario creado. Se ha enviado un correo de bienvenida.' });
  } catch (error) {
    console.error("Error en createUsuario:", error);
    res.status(500).json({ message: "Error al crear usuario" });
  }
};


// Actualizar un usuario
const updateUsuario = async (req, res) => {
  try {
    const id = req.params.id;
    const { nombre, email, rol, password, bloqueado } = req.body;

    // Convertir a booleano (1 o 0)
    const bloqueadoConvertido =
      bloqueado === "1" || bloqueado === 1 || bloqueado === true || bloqueado === "true" ? 1 : 0;

    // Validar que no haya más de un admin_general
    if (rol === "admin_general") {
      const adminExistente = await Usuario.getUsuarioByRol("admin_general");

      if (adminExistente && adminExistente.id_usuario !== parseInt(id)) {
        return res.status(409).json({
          message: "Ya existe un usuario con rol admin_general; solo puede haber un administrador.",
        });
      }
    }

    let hashedPassword = null;

    if (password && password.trim() !== "") {
      if (password.trim().length < 8) {
        return res.status(400).json({ message: "La contraseña debe tener al menos 8 caracteres" });
      }

      hashedPassword = await bcrypt.hash(password, 10);
    }

    await Usuario.updateUsuario(
      id,
      nombre,
      email,
      rol,
      hashedPassword,
      bloqueadoConvertido
    );


    // Construir mensaje con los campos modificados
    let cambios = [];
    if (typeof nombre !== 'undefined') cambios.push(`Nombre: ${nombre}`);
    if (typeof email !== 'undefined') cambios.push(`Email: ${email}`);
    if (typeof rol !== 'undefined') cambios.push(`Rol: ${rol}`);
    if (typeof password !== 'undefined' && password.trim() !== '') cambios.push('Contraseña: (actualizada)');
    if (typeof bloqueado !== 'undefined') cambios.push(`Bloqueado: ${bloqueadoConvertido ? 'Sí' : 'No'}`);

    await registrarAccion({
      req,
      accion: 'actualizó',
      entidad: 'usuario',
      entidadId: id,
      mensajeExtra: cambios.length > 0 ? cambios.join(', ') : ''
    });

    // Buscar admin_general para notificarle por correo
    const pool = require('../db/connection');
    const { enviarCorreo } = require('../services/correoService');
    const url = 'https://bechapra.com';
    const [admins] = await pool.query("SELECT email, nombre FROM usuarios WHERE rol = 'admin_general'");
    if (admins.length > 0) {
      const admin = admins[0];
      await enviarCorreo({
        para: admin.email,
        asunto: 'Usuario editado en Bechapra',
        nombre: admin.nombre,
        link: url,
        mensaje: `Se ha editado un usuario:<br><b>ID:</b> ${id}<br>${cambios.length > 0 ? cambios.join('<br>') : ''}`
      });
    }

    res.json({ message: "Usuario actualizado correctamente" });
  } catch (error) {
    console.error("Error en updateUsuario:", error);
    res.status(500).json({ message: "Error al actualizar usuario" });
  }
};




// Eliminar un usuario
const deleteUsuario = async (req, res) => {
  try {
    // Obtener datos del usuario a eliminar antes de borrarlo
    const usuarioEliminado = await Usuario.getUsuarioById(req.params.id);
    if (!usuarioEliminado) return res.status(404).json({ message: "Usuario no encontrado" });

    // Registrar acción
    await registrarAccion({
      req,
      accion: 'eliminó',
      entidad: 'usuario',
      entidadId: req.params.id,
      mensajeExtra: `Nombre: ${usuarioEliminado.nombre}, Email: ${usuarioEliminado.email}, Rol: ${usuarioEliminado.rol}`
    });

    // Buscar admin_general para notificarle por correo
    const pool = require('../db/connection');
    const { enviarCorreo } = require('../services/correoService');
    const url = 'https://bechapra.com';
    const [admins] = await pool.query("SELECT email, nombre FROM usuarios WHERE rol = 'admin_general'");
    if (admins.length > 0) {
      const admin = admins[0];
      await enviarCorreo({
        para: admin.email,
        asunto: 'Usuario eliminado en Bechapra',
        nombre: admin.nombre,
        link: url,
        mensaje: `Se ha eliminado un usuario:<br><b>Nombre:</b> ${usuarioEliminado.nombre}<br><b>Email:</b> ${usuarioEliminado.email}<br><b>Rol:</b> ${usuarioEliminado.rol}`
      });
    }

    const deleted = await Usuario.deleteUsuario(req.params.id);
    res.json({ message: "Usuario eliminado" });
  } catch (error) {
    console.error("Error en deleteUsuario:", error);
    res.status(500).json({ message: "Error al eliminar usuario" });
  }
};

// Verificar email por token
const verificarEmail = async (req, res) => {
  const { token } = req.query;
  if (!token) return res.status(400).json({ message: 'Token faltante' });
  try {
    const pool = require('../db/connection');
    const [rows] = await pool.query('SELECT * FROM usuarios WHERE email_token = ?', [token]);
    if (rows.length === 0) return res.status(400).json({ message: 'Token inválido o expirado' });
    const usuario = rows[0];
    if (usuario.verificado) return res.status(200).json({ message: 'El correo ya estaba verificado' });
    await pool.query('UPDATE usuarios SET verificado = true, email_token = NULL WHERE id_usuario = ?', [usuario.id_usuario]);
    res.status(200).json({ message: 'Correo verificado correctamente' });
  } catch (error) {
    console.error('Error en verificarEmail:', error);
    res.status(500).json({ message: 'Error al verificar el correo' });
  }
};

// Exportar funciones
module.exports = {
  getUsuarios,
  getUsuario,
  createUsuario,
  updateUsuario,
  deleteUsuario,
  verificarEmail,
};
