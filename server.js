const app = require("./app");
const auditoriaNotificacionesRouter = require("./routes/auditoria_notificaciones.routes");
require("dotenv").config();
require("./tareas/recurrentes");
const http = require("http");
const jwt = require("jsonwebtoken");

// WebSocket
const { wss, enviarNotificacion } = require("./ws");

const PORT = process.env.PORT || 4000;

// Registrar rutas de auditoría y notificaciones
app.use("/api", auditoriaNotificacionesRouter);

// Crear servidor HTTP manualmente
const server = http.createServer(app);

// Asociar el WebSocket Server al HTTP Server
server.on("upgrade", (request, socket, head) => {
  const token = new URLSearchParams(request.url.replace("/?", "")).get("token");

  if (!token) return socket.destroy();

  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET);
    const userId = payload.id_usuario;

    wss.handleUpgrade(request, socket, head, (ws) => {
      wss.emit("connection", ws, request, userId);

      // ⏳ Esperar 3 segundos y luego enviar notificación de prueba
      setTimeout(() => {
        console.log("🚀 Enviando notificación de prueba a usuario", userId);
        enviarNotificacion(userId, "🔔 Esta es una notificación de prueba desde el servidor.");
      }, 3000);
    });
  } catch (err) {
    console.error("Token inválido en WebSocket:", err.message);
    socket.destroy();
  }
});

// Iniciar el servidor
server.listen(PORT, '0.0.0.0', () => {
  console.log(`Servidor HTTP y WebSocket en http://localhost:${PORT}`);
});
