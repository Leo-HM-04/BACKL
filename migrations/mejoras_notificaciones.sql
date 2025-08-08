-- ──────────────────────────────────────────────────────────────
-- Migración para mejorar el sistema de notificaciones
-- Agregar campos adicionales para notificaciones más detalladas
-- ────────────────────────────────────────────────────────────── 

-- Agregar columnas adicionales a la tabla notificaciones
ALTER TABLE `notificaciones` 
ADD COLUMN `tipo` VARCHAR(50) NULL DEFAULT 'info' COMMENT 'Tipo específico de notificación' AFTER `mensaje`,
ADD COLUMN `prioridad` ENUM('baja','normal','alta','critica') DEFAULT 'normal' COMMENT 'Prioridad de la notificación' AFTER `tipo`,
ADD COLUMN `entidad` VARCHAR(50) NULL COMMENT 'Entidad relacionada (solicitud, viatico, etc.)' AFTER `prioridad`,
ADD COLUMN `entidad_id` INT NULL COMMENT 'ID de la entidad relacionada' AFTER `entidad`,
ADD COLUMN `id_usuario_emisor` INT NULL COMMENT 'Usuario que generó la notificación' AFTER `entidad_id`,
ADD COLUMN `metadata` JSON NULL COMMENT 'Datos adicionales en formato JSON' AFTER `id_usuario_emisor`;

-- Agregar índices para mejorar performance
ALTER TABLE `notificaciones` 
ADD INDEX `idx_usuario_leida_fecha` (`id_usuario`, `leida`, `fecha_creacion`),
ADD INDEX `idx_tipo_prioridad` (`tipo`, `prioridad`),
ADD INDEX `idx_entidad` (`entidad`, `entidad_id`),
ADD INDEX `idx_emisor` (`id_usuario_emisor`);

-- Agregar foreign key para usuario emisor
ALTER TABLE `notificaciones` 
ADD CONSTRAINT `fk_notificaciones_emisor` 
FOREIGN KEY (`id_usuario_emisor`) REFERENCES `usuarios` (`id_usuario`) 
ON DELETE SET NULL ON UPDATE CASCADE;

-- Crear tabla para auditoría de notificaciones (opcional)
CREATE TABLE IF NOT EXISTS `notificaciones_auditoria` (
  `id_auditoria` INT AUTO_INCREMENT PRIMARY KEY,
  `id_notificacion` INT NOT NULL,
  `accion` ENUM('creada','leida','eliminada') NOT NULL,
  `fecha_accion` DATETIME DEFAULT CURRENT_TIMESTAMP,
  `ip_usuario` VARCHAR(45) NULL,
  `user_agent` TEXT NULL,
  INDEX `idx_notificacion_fecha` (`id_notificacion`, `fecha_accion`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci COMMENT='Auditoría de acciones sobre notificaciones';

-- Crear tabla para plantillas de notificaciones
CREATE TABLE IF NOT EXISTS `notificaciones_plantillas` (
  `id_plantilla` INT AUTO_INCREMENT PRIMARY KEY,
  `tipo` VARCHAR(50) NOT NULL UNIQUE,
  `nombre` VARCHAR(100) NOT NULL,
  `plantilla_admin` TEXT NOT NULL COMMENT 'Plantilla para admin_general',
  `plantilla_aprobador` TEXT NOT NULL COMMENT 'Plantilla para aprobador',
  `plantilla_solicitante` TEXT NOT NULL COMMENT 'Plantilla para solicitante', 
  `plantilla_pagador` TEXT NOT NULL COMMENT 'Plantilla para pagador_banca',
  `activa` BOOLEAN DEFAULT TRUE,
  `created_at` DATETIME DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci COMMENT='Plantillas personalizables de notificaciones por rol';

-- Insertar plantillas por defecto
INSERT INTO `notificaciones_plantillas` (`tipo`, `nombre`, `plantilla_admin`, `plantilla_aprobador`, `plantilla_solicitante`, `plantilla_pagador`) VALUES

('solicitud_creada', 'Solicitud Creada', 
 '📝 <strong>{{emisor_nombre}}</strong> ({{emisor_rol}}) de <strong>{{emisor_departamento}}</strong> creó una nueva solicitud por <strong>${{monto}}</strong><br>📋 <strong>Concepto:</strong> {{concepto}}<br>🏢 <strong>Empresa:</strong> {{empresa_a_pagar}}<br>📅 <strong>Límite:</strong> {{fecha_limite_pago}}',
 '📝 Nueva solicitud para revisar de <strong>{{emisor_nombre}}</strong> ({{emisor_departamento}})<br>💰 <strong>Monto:</strong> ${{monto}}<br>📋 <strong>Concepto:</strong> {{concepto}}<br>⏰ <strong>Requiere aprobación</strong>',
 '📝 Tu solicitud por <strong>${{monto}}</strong> fue registrada exitosamente<br>📋 <strong>Concepto:</strong> {{concepto}}<br>⏳ <strong>Estado:</strong> Pendiente de aprobación',
 '📝 Nueva solicitud creada por <strong>{{emisor_nombre}}</strong><br>💰 <strong>Monto:</strong> ${{monto}}<br>📋 <strong>Concepto:</strong> {{concepto}}'),

('solicitud_aprobada', 'Solicitud Aprobada',
 '✅ <strong>{{emisor_nombre}}</strong> aprobó la solicitud de <strong>{{solicitante_nombre}}</strong><br>💰 <strong>Monto:</strong> ${{monto}}<br>🏢 <strong>Departamento:</strong> {{solicitante_departamento}}',
 '✅ Aprobaste la solicitud de <strong>{{solicitante_nombre}}</strong> por <strong>${{monto}}</strong>',
 '✅ ¡Tu solicitud por <strong>${{monto}}</strong> fue <strong>APROBADA</strong> por <strong>{{emisor_nombre}}</strong>!<br>📋 <strong>Concepto:</strong> {{concepto}}<br>💳 <strong>Próximo paso:</strong> Procesamiento de pago',
 '✅ Nueva solicitud <strong>AUTORIZADA</strong> para procesar pago<br>👤 <strong>Solicitante:</strong> {{solicitante_nombre}} ({{solicitante_departamento}})<br>💰 <strong>Monto:</strong> ${{monto}}<br>✅ <strong>Aprobada por:</strong> {{emisor_nombre}}'),

('solicitud_rechazada', 'Solicitud Rechazada',
 '❌ <strong>{{emisor_nombre}}</strong> rechazó la solicitud de <strong>{{solicitante_nombre}}</strong><br>💰 <strong>Monto:</strong> ${{monto}}<br>📝 <strong>Motivo:</strong> {{comentario_aprobador}}',
 '❌ Rechazaste la solicitud de <strong>{{solicitante_nombre}}</strong> por <strong>${{monto}}</strong>',
 '❌ Tu solicitud por <strong>${{monto}}</strong> fue <strong>RECHAZADA</strong> por <strong>{{emisor_nombre}}</strong><br>📝 <strong>Motivo:</strong> {{comentario_aprobador}}<br>💡 <strong>Puedes crear una nueva solicitud corrigiendo los aspectos indicados</strong>',
 '❌ Solicitud de <strong>{{solicitante_nombre}}</strong> fue rechazada por <strong>{{emisor_nombre}}</strong>'),

('solicitud_pagada', 'Solicitud Pagada',
 '💸 <strong>{{emisor_nombre}}</strong> procesó el pago de la solicitud de <strong>{{solicitante_nombre}}</strong><br>💰 <strong>Monto:</strong> ${{monto}}<br>🏢 <strong>Departamento:</strong> {{solicitante_departamento}}',
 '💸 La solicitud que aprobaste de <strong>{{solicitante_nombre}}</strong> ha sido pagada<br>💰 <strong>Monto:</strong> ${{monto}}<br>🏦 <strong>Procesado por:</strong> {{emisor_nombre}}',
 '💸 ¡Tu solicitud por <strong>${{monto}}</strong> ha sido <strong>PAGADA</strong>!<br>📋 <strong>Concepto:</strong> {{concepto}}<br>💳 <strong>Cuenta destino:</strong> {{cuenta_destino}}<br>🏦 <strong>Procesado por:</strong> {{emisor_nombre}}',
 '💸 Procesaste el pago de <strong>{{solicitante_nombre}}</strong> por <strong>${{monto}}</strong>');

-- Actualizar notificaciones existentes con valores por defecto
UPDATE `notificaciones` SET 
  `tipo` = 'info',
  `prioridad` = 'normal'
WHERE `tipo` IS NULL OR `prioridad` IS NULL;
