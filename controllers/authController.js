const pool = require('../db/connection');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET;
const MAX_INTENTOS_TEMPORAL = 3; // Intentos para el primer bloqueo temporal
const MAX_INTENTOS_PERMANENTE = 1; // Un intento después del bloqueo temporal para el permanente
const TIEMPO_BLOQUEO_MS = 15 * 1000; // 15 segundos

const Joi = require('joi');

exports.login = async (req, res) => {
  // Validación robusta con Joi
  const schema = Joi.object({
    email: Joi.string().email().required(),
    password: Joi.string().min(8).max(100).required(),
  });
  const { error, value } = schema.validate(req.body);
  const ip = req.headers['x-forwarded-for'] || req.connection.remoteAddress || '';
  if (error) {
    // Auditar intento fallido por datos inválidos
    try { await pool.query('INSERT INTO login_audit (email, ip, exito) VALUES (?, ?, ?)', [req.body.email || '', ip, false]); } catch (e) {}
    return res.status(400).json({ message: 'Datos inválidos', details: error.details });
  }
  const { email, password } = value;

  try {
    const [rows] = await pool.query('SELECT * FROM usuarios WHERE email = ?', [email]);

    if (rows.length === 0) {
      // Auditar intento fallido por usuario inexistente
      try { await pool.query('INSERT INTO login_audit (email, ip, exito) VALUES (?, ?, ?)', [email, ip, false]); } catch (e) {}
      return res.status(401).json({ message: 'Credenciales inválidas' });
    }


    const user = rows[0];
    // Verificar si el usuario está verificado
    if (!user.verificado) {
      return res.status(403).json({ message: 'Debes verificar tu correo antes de iniciar sesión.' });
    }

    // 1. Verificar bloqueo permanente
    if (user.bloqueado) {
      return res.status(403).json({ message: 'Cuenta bloqueada permanentemente. Contacta al administrador.' });
    }

    // 2. Verificar si hay un bloqueo temporal activo
    if (user.bloqueo_temporal_fin) {
      const ahora = new Date();
      const finBloqueo = new Date(user.bloqueo_temporal_fin);

      if (finBloqueo > ahora) {
        // Todavía está dentro del período de bloqueo temporal
        const segRestantes = Math.ceil((finBloqueo - ahora) / 1000);
        return res.status(403).json({ message: `Cuenta bloqueada temporalmente. Intenta de nuevo en ${segRestantes} segundos.` });
      } else {
        // El tiempo de bloqueo temporal ha expirado
        // Reseteamos el bloqueo_temporal_fin, pero mantenemos intentos_fallidos
        // y bloqueo_temporal_activado para la siguiente lógica.
        await pool.query(`
          UPDATE usuarios
          SET bloqueo_temporal_fin = NULL
          WHERE id_usuario = ?
        `, [user.id_usuario]);
        user.bloqueo_temporal_fin = null; // Actualizar el objeto user en memoria
        // El `intentos_fallidos` NO se resetea aquí. Es crucial para el siguiente paso.
      }
    }

    const isValid = await bcrypt.compare(password, user.password);

    if (!isValid) {
      // Auditar intento fallido por contraseña incorrecta
      try { await pool.query('INSERT INTO login_audit (email, ip, exito) VALUES (?, ?, ?)', [email, ip, false]); } catch (e) {}
      // Contraseña incorrecta
      let intentos = user.intentos_fallidos || 0;
      intentos++;

      if (user.bloqueo_temporal_activado) {
        // Si ya fue bloqueado temporalmente antes y falla de nuevo (es su "último intento")
        if (intentos > MAX_INTENTOS_PERMANENTE) { // Si falla una vez más después de bloqueo temporal
          // -> Bloqueo Permanente
          await pool.query(`
            UPDATE usuarios
            SET bloqueado = TRUE, intentos_fallidos = 0, bloqueo_temporal_fin = NULL, bloqueo_temporal_activado = FALSE
            WHERE id_usuario = ?
          `, [user.id_usuario]);
          return res.status(403).json({ message: 'Cuenta bloqueada permanentemente por múltiples intentos fallidos. Contacta al administrador.' });
        } else {
          // Es su "último intento" después del bloqueo temporal
          await pool.query(`
            UPDATE usuarios
            SET intentos_fallidos = ?
            WHERE id_usuario = ?
          `, [intentos, user.id_usuario]);
          // Este mensaje es crucial para el frontend
          return res.status(401).json({ message: `Credenciales inválidas. Último intento antes del bloqueo permanente.` });
        }
      } else {
        // No ha sido bloqueado temporalmente todavía
        if (intentos >= MAX_INTENTOS_TEMPORAL) {
          // Ha llegado a 3 intentos fallidos -> Primer bloqueo temporal
          const bloqueoFin = new Date(Date.now() + TIEMPO_BLOQUEO_MS);
          await pool.query(`
            UPDATE usuarios
            SET bloqueo_temporal_fin = ?, intentos_fallidos = ?, bloqueo_temporal_activado = TRUE
            WHERE id_usuario = ?
          `, [bloqueoFin, intentos, user.id_usuario]);

          return res.status(403).json({ message: `Cuenta bloqueada temporalmente por ${TIEMPO_BLOQUEO_MS / 1000} segundos.` });
        } else {
          // Incrementar el contador de intentos fallidos antes del bloqueo temporal
          await pool.query(`
            UPDATE usuarios
            SET intentos_fallidos = ?
            WHERE id_usuario = ?
          `, [intentos, user.id_usuario]);

          return res.status(401).json({ message: `Credenciales inválidas. Intento ${intentos} de ${MAX_INTENTOS_TEMPORAL}.` });
        }
      }
    }

    // Contraseña correcta -> limpiar todo y permitir acceso y marcar como activo
    await pool.query(`
      UPDATE usuarios
      SET intentos_fallidos = 0, bloqueo_temporal_fin = NULL, bloqueo_temporal_activado = FALSE, activo = 1
      WHERE id_usuario = ?
    `, [user.id_usuario]);

    // Auditar intento exitoso
    try { await pool.query('INSERT INTO login_audit (email, ip, exito) VALUES (?, ?, ?)', [email, ip, true]); } catch (e) {}

    const token = jwt.sign({
      id_usuario: user.id_usuario,
      email: user.email,
      rol: user.rol,
    }, JWT_SECRET, { expiresIn: '8h' });

    res.json({
      token,
      user: {
        id_usuario: user.id_usuario,
        nombre: user.nombre,
        email: user.email,
        rol: user.rol,
      }
    });

  } catch (error) {
    console.error('Error en login:', error);
    res.status(500).json({ message: 'Error interno del servidor' });
  }
};

exports.obtenerHistorial = async (req, res) => {
  try {
    const { rol, id_usuario } = req.user;
    const esSolicitante = rol === "solicitante";

    const historial = await RecurrenteModel.obtenerHistorial(id_usuario, esSolicitante);
    res.json(historial);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Error al obtener historial de ejecuciones" });
  }
};

// Obtener información del usuario autenticado
exports.me = async (req, res) => {
  try {
    const id_usuario = req.user?.id_usuario;
    if (!id_usuario) return res.status(401).json({ message: 'Usuario no autenticado' });
    
    const [rows] = await pool.query(
      'SELECT id_usuario, nombre, email, rol, verificado, activo FROM usuarios WHERE id_usuario = ?', 
      [id_usuario]
    );
    
    if (rows.length === 0) {
      return res.status(404).json({ message: 'Usuario no encontrado' });
    }
    
    res.json(rows[0]);
  } catch (error) {
    console.error('Error en me:', error);
    res.status(500).json({ message: 'Error al obtener información del usuario' });
  }
};

// Cerrar sesión: marcar usuario como inactivo
exports.logout = async (req, res) => {
  try {
    const id_usuario = req.user?.id_usuario;
    if (!id_usuario) return res.status(400).json({ message: 'Usuario no autenticado' });
    await pool.query('UPDATE usuarios SET activo = FALSE WHERE id_usuario = ?', [id_usuario]);
    res.json({ message: 'Sesión cerrada y usuario marcado como inactivo' });
  } catch (error) {
    console.error('Error en logout:', error);
    res.status(500).json({ message: 'Error al cerrar sesión' });
  }
};