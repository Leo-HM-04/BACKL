const express = require('express');
const router = express.Router();
const notificacionesService = require('../services/notificacionesService');
const notificacionesServiceMejorado = require('../services/notificacionesServiceMejorado');
const pool = require('../db/connection');
// Middleware de autenticación (ajusta según tu proyecto)
const { authMiddleware } = require('../middlewares/authMiddleware');

// Endpoint exclusivo para solicitante: obtiene solo sus notificaciones
router.get('/solicitante', authMiddleware, async (req, res) => {
  try {
    const id_usuario = req.user.id_usuario;
    // Solo notificaciones del usuario autenticado (rol solicitante)
    if (req.user.rol !== 'solicitante') {
      return res.status(403).json({ error: 'Solo disponible para solicitantes' });
    }
    const notificaciones = await notificacionesService.obtenerNotificaciones(id_usuario);
    res.json(notificaciones);
  } catch (error) {
    res.status(500).json({ error: 'Error al obtener notificaciones del solicitante' });
  }
});

// Obtener notificaciones mejoradas con información detallada
router.get('/mejoradas', authMiddleware, async (req, res) => {
  try {
    const id_usuario = req.user.id_usuario;
    const limite = parseInt(req.query.limite) || 50;
    
    const notificaciones = await notificacionesServiceMejorado.obtenerNotificacionesMejoradas(id_usuario, limite);
    res.json(notificaciones);
  } catch (error) {
    console.error('[NotificacionesRoutes] Error obteniendo notificaciones mejoradas:', error);
    res.status(500).json({ error: 'Error al obtener notificaciones mejoradas' });
  }
});

// Obtener todas las notificaciones del usuario autenticado (versión anterior - compatibilidad)
router.get('/', authMiddleware, async (req, res) => {
  try {
    const id_usuario = req.user.id_usuario;
    const notificaciones = await notificacionesService.obtenerNotificaciones(id_usuario);
    res.json(notificaciones);
  } catch (error) {
    res.status(500).json({ error: 'Error al obtener notificaciones' });
  }
});

// Marcar notificación como leída
router.post('/:id/marcar-leida', authMiddleware, async (req, res) => {
  try {
    await notificacionesService.marcarComoLeida(req.params.id);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: 'Error al marcar notificación como leída' });
  }
});

// Marcar todas las notificaciones como leídas
router.post('/marcar-todas-leidas', authMiddleware, async (req, res) => {
  try {
    const id_usuario = req.user.id_usuario;
    await pool.query(
      "UPDATE notificaciones SET leida = 1 WHERE id_usuario = ? AND leida = 0",
      [id_usuario]
    );
    res.json({ success: true, message: 'Todas las notificaciones han sido marcadas como leídas' });
  } catch (error) {
    console.error('[NotificacionesRoutes] Error marcando todas como leídas:', error);
    res.status(500).json({ error: 'Error al marcar todas las notificaciones como leídas' });
  }
});

// Obtener estadísticas de notificaciones
router.get('/estadisticas', authMiddleware, async (req, res) => {
  try {
    const id_usuario = req.user.id_usuario;
    
    const [stats] = await pool.query(`
      SELECT 
        COUNT(*) as total,
        SUM(CASE WHEN leida = 0 THEN 1 ELSE 0 END) as no_leidas,
        SUM(CASE WHEN leida = 0 AND prioridad = 'alta' THEN 1 ELSE 0 END) as alta_prioridad,
        SUM(CASE WHEN leida = 0 AND prioridad = 'critica' THEN 1 ELSE 0 END) as criticas,
        SUM(CASE WHEN tipo LIKE '%solicitud%' AND leida = 0 THEN 1 ELSE 0 END) as solicitudes_pendientes,
        SUM(CASE WHEN tipo LIKE '%viatico%' AND leida = 0 THEN 1 ELSE 0 END) as viaticos_pendientes
      FROM notificaciones 
      WHERE id_usuario = ?
    `, [id_usuario]);
    
    res.json(stats[0] || {
      total: 0,
      no_leidas: 0,
      alta_prioridad: 0,
      criticas: 0,
      solicitudes_pendientes: 0,
      viaticos_pendientes: 0
    });
  } catch (error) {
    console.error('[NotificacionesRoutes] Error obteniendo estadísticas:', error);
    res.status(500).json({ error: 'Error al obtener estadísticas de notificaciones' });
  }
});

// Eliminar notificación (soft delete o físico según configuración)
router.delete('/:id', authMiddleware, async (req, res) => {
  try {
    const { id } = req.params;
    const id_usuario = req.user.id_usuario;
    
    // Verificar que la notificación pertenece al usuario
    const [notif] = await pool.query(
      "SELECT id_notificacion FROM notificaciones WHERE id_notificacion = ? AND id_usuario = ?",
      [id, id_usuario]
    );
    
    if (notif.length === 0) {
      return res.status(404).json({ error: 'Notificación no encontrada' });
    }
    
    // Eliminar la notificación
    await pool.query("DELETE FROM notificaciones WHERE id_notificacion = ?", [id]);
    
    res.json({ success: true, message: 'Notificación eliminada' });
  } catch (error) {
    console.error('[NotificacionesRoutes] Error eliminando notificación:', error);
    res.status(500).json({ error: 'Error al eliminar la notificación' });
  }
});

module.exports = router;
