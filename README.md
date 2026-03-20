# 🔐 Death Switch

Un sistema de verificación y encriptación de datos que envía verificaciones periódicas para confirmar que el propietario sigue vivo. Si no se recibe respuesta, notifica a los contactos de emergencia con un enlace (y opcionalmente un adjunto) para descargar un ZIP con los documentos en **formato legible**; en el servidor los archivos siguen guardados también cifrados.

## 🚀 Características

- **Encriptación AES-256**: Protección robusta de archivos y datos
- **Verificaciones periódicas**: Envío automático de emails de verificación
- **Notificaciones de emergencia**: Alerta automática a contactos designados
- **Interfaz web moderna**: Panel de control intuitivo y responsive
- **Base de datos SQLite**: Almacenamiento local y eficiente
- **Templates de email personalizables**: Mensajes profesionales y claros
- **Sistema de tokens seguros**: Verificación mediante enlaces únicos

## 📋 Requisitos

- Node.js 16+
- npm o yarn
- Cuenta de email SMTP (Gmail, Outlook, etc.)

## 🛠️ Instalación

1. **Clonar el repositorio**

   ```bash
   git clone https://github.com/maagmirror/death-switch.git
   cd death-switch
   ```

2. **Instalar dependencias**

   ```bash
   npm install
   ```

3. **Configurar variables de entorno**

   ```bash
   cp env.example .env
   ```

   Editar el archivo `.env` con tu configuración:

   ```env
   # Configuración de la aplicación
   NODE_ENV=development
   PORT=3000

   # Configuración de autenticación
   ADMIN_USERNAME=admin
   ADMIN_PASSWORD=tu_contraseña_super_segura_aqui

   # Configuración de verificación
   VERIFICATION_INTERVAL_DAYS=7
   VERIFICATION_INTERVAL_MINUTES=0  # Modo testing se configura desde el panel web
   DATA_FOLDER=./encrypted_data
   DECRYPTION_KEY=tu_clave_super_secreta_aqui
   BASE_URL=http://localhost:3000

   # Emergencia (opcional): caducidad del enlace de descarga para contactos; tamaño máximo del ZIP como adjunto (MB)
   # EMERGENCY_DOWNLOAD_EXPIRY_DAYS=90
   # EMERGENCY_ZIP_MAX_ATTACH_MB=12

   # Configuración SMTP
   SMTP_HOST=smtp.gmail.com
   SMTP_PORT=587
   SMTP_SECURE=false
   SMTP_USER=tu_email@gmail.com
   SMTP_PASS=tu_password_de_aplicacion
   # Opcional: remitente visible (algunos proveedores exigen el mismo dominio que SMTP_USER)
   # SMTP_FROM="Death Switch <tu_email@gmail.com>"
   # MAIL_TIMEZONE=America/Argentina/Buenos_Aires

   # Emails de contacto
   OWNER_EMAIL=tu_email@gmail.com
   CONTACT_EMAILS=contacto1@email.com,contacto2@email.com,contacto3@email.com

   # Configuración de la base de datos
   DB_PATH=./data/death_switch.db
   ```

4. **Iniciar la aplicación**
   ```bash
   npm start
   ```

### Docker

```bash
docker build -t death-switch .
docker run --rm -p 3000:3000 --env-file .env \
  -v death-switch-data:/app/data \
  -v death-switch-enc:/app/encrypted_data \
  -v death-switch-orig:/app/original_files \
  death-switch
```

La imagen **no** incluye `.env` (está ignorado en el build). Pasá variables con `--env-file` o `-e`. El punto de entrada es `node src/index.js`.

## 📧 Configuración de Email

### Gmail

1. Activar autenticación de 2 factores
2. Generar contraseña de aplicación
3. Usar esa contraseña en `SMTP_PASS`

### Outlook/Hotmail

```env
SMTP_HOST=smtp-mail.outlook.com
SMTP_PORT=587
SMTP_SECURE=false
```

### MailHog (pruebas en local)

- **SMTP** en el puerto que indique MailHog (suele ser **1025**). **Interfaz web** para ver los correos: **http://localhost:8025**
- En `.env`: `SMTP_AUTH=false` y podés dejar `SMTP_USER` / `SMTP_PASS` vacíos
- El envío **automático** solo ocurre cuando llega la fecha `next_verification` en la base (a menudo **días** después del primer arranque). Para probar al instante: entrá al panel → **Forzar verificación** (o `POST /api/force-verification` con sesión). En consola deberías ver `📧 Correo enviado → …` y el mensaje en MailHog

### Otros proveedores

Consultar la documentación de tu proveedor de email para obtener los datos SMTP.

## 🔧 Uso

### 1. Acceder al panel de control

Abre tu navegador y ve a `http://localhost:3000/login`

**Credenciales por defecto:**

- Usuario: `admin`
- Contraseña: `admin123`

**⚠️ IMPORTANTE:** Cambia estas credenciales en el archivo `.env` antes de usar en producción.

### 2. Encriptar archivos

- Haz clic en "Encriptar Archivos"
- Arrastra o selecciona los archivos que quieres proteger
- Los archivos se encriptarán y almacenarán en la carpeta `encrypted_data`

### 3. Configurar verificaciones

- El sistema enviará verificaciones automáticas según el intervalo configurado
- Recibirás emails con enlaces para confirmar que sigues vivo
- Si no respondes en 24 horas, se activará el protocolo de emergencia

### 4. Modo Testing

- **Desde el panel**: Usa el botón "Modo Testing" para activar verificaciones cada X minutos
- **Verificaciones rápidas**: Recibe emails cada 1-60 minutos para testing
- **Volver a producción**: Desactiva el modo testing desde el panel
- **Configuración automática**: El sistema ajusta automáticamente los intervalos sin necesidad de editar el `.env`
- **Base de datos**: Si la BD se creó antes en modo “días”, `next_verification` podía quedar a +7 días y **no mandaba mail** aunque el cron corriera cada minuto. Ahora se **corrige al activar modo test** o al arrancar: si la fecha está demasiado lejos para el intervalo de prueba, se alinea para el próximo ciclo

### 5. Gestión de contactos

- Los contactos de emergencia recibirán notificaciones automáticas
- Recibirán un enlace (y a veces un adjunto) para descargar un ZIP con los documentos en la carpeta `archivos/`, sin necesidad de clave técnica

## 📁 Estructura del Proyecto

```
death-switch/
├── src/
│   ├── index.js              # Servidor principal
│   ├── database.js           # Gestión de base de datos
│   └── services/
│       ├── emailService.js   # Servicio de email
│       ├── verificationService.js # Verificaciones periódicas
│       └── encryptionService.js   # Encriptación/desencriptación
├── views/
│   └── dashboard.html        # Panel (fuera de /public para no exponerlo por static)
├── public/
│   ├── login.html
│   └── verify.html           # Página de verificación pública
├── templates/                # Templates de email
├── encrypted_data/           # Archivos encriptados
├── data/                     # Base de datos SQLite
├── package.json
├── env.example
└── README.md
```

## 🔐 Seguridad

### Credenciales de Administrador

- **IMPORTANTE**: Cambia las credenciales por defecto en el archivo `.env`
- Usa un usuario y contraseña fuertes y seguros
- No compartas estas credenciales con nadie
- La contraseña debe tener al menos 8 caracteres

### Clave de Desencriptación (`DECRYPTION_KEY`)

- **IMPORTANTE**: Cambia la clave por defecto en el archivo `.env`
- Usa una clave fuerte; sirve para cifrar las copias en disco y para la utilidad `scripts/decrypt.js` si alguien solo tiene los `.encrypted`
- Los contactos de emergencia **no necesitan** esta clave para abrir el ZIP de emergencia (lleva copias en claro en `archivos/`). Guárdala tú para recuperación técnica o copias cifradas

### Archivos Encriptados

- En disco se guardan copias AES-256-CBC (IV de 16 bytes al inicio de cada `.encrypted`)
- Se conserva una copia legible en `original_files/` para poder generar el ZIP de emergencia sin pedir a nadie que instale Node ni desencripte nada

### Tokens de Verificación

- Tokens únicos generados con UUID v4
- Expiran automáticamente después de 24 horas
- Se invalidan después de un uso

## 📧 Templates de Email

Los templates se encuentran en la carpeta `templates/` y se pueden personalizar:

- `verification.hbs`: Email de verificación periódica
- `death_notification.hbs`: Notificación de fallecimiento
- `contact_info.hbs`: Información para contactos

## 🚨 Protocolo de Emergencia

1. **Verificación fallida**: Tras el tiempo de gracia configurado (p. ej. 24 h en producción)
2. **Creación de ZIP**: Se empaquetan los archivos legibles de `original_files/` (carpeta `archivos/` dentro del ZIP) más `LEEME.txt`
3. **Enlace público**: Se genera un token único; el enlace es del estilo `/emergency/download/<token>` (no requiere login)
4. **Notificación**: Email a los contactos con el enlace y, si el ZIP no supera el límite (p. ej. 12 MB), adjunto del mismo archivo

## 🔧 Comandos Útiles

```bash
# Iniciar en modo desarrollo
npm run dev

# Iniciar en producción
npm start

# Ejecutar tests
npm test

# Forzar verificación manual
curl -X POST http://localhost:3000/api/verify -H "Content-Type: application/json" -d '{"token":"tu-token"}'
```

## 🐛 Solución de Problemas

### Error de conexión SMTP

- Verificar credenciales en `.env`
- Asegurar que la autenticación de 2 factores esté activada
- Verificar que el puerto SMTP sea correcto

### `550 relay not permitted` / rechazo del destinatario

El servidor SMTP aceptó la conexión pero **no permite enviar a ese destino** (p. ej. a Gmail desde un SMTP de hosting). Revisá:

- **`SMTP_FROM`** (o el remitente por defecto): muchos proveedores exigen que coincida con la cuenta autenticada (`SMTP_USER`).
- **Gmail**: contraseña de **aplicación**, no la clave normal.
- **Hosting**: a veces solo dejan relay a buzones del **mismo dominio**; para Gmail usa el SMTP de Gmail o un servicio tipo SendGrid/Resend.

### Archivos no se encriptan

- Verificar permisos de escritura en la carpeta `encrypted_data`
- Comprobar que la clave de desencriptación esté configurada

### Verificaciones no se envían

- Verificar configuración de cron en el servidor
- Comprobar logs del servidor para errores
- Verificar que el email del propietario esté configurado

## 📝 Logs

Los logs se muestran en la consola del servidor:

- ✅ Operaciones exitosas
- ❌ Errores
- 📧 Envío de emails
- 🔐 Operaciones de encriptación
- ⏰ Programación de verificaciones

## 🤝 Contribuir

1. Fork el proyecto
2. Crea una rama para tu feature (`git checkout -b feature/AmazingFeature`)
3. Commit tus cambios (`git commit -m 'Add some AmazingFeature'`)
4. Push a la rama (`git push origin feature/AmazingFeature`)
5. Abre un Pull Request

## 📄 Licencia

Este proyecto está bajo la Licencia MIT. Ver el archivo `LICENSE` para más detalles.

## ⚠️ Descargo de Responsabilidad

Este software se proporciona "tal como está" sin garantías. El uso de este sistema es responsabilidad del usuario. Los desarrolladores no se hacen responsables por la pérdida de datos o cualquier consecuencia del uso de este software.

## 📞 Soporte

Para soporte técnico o preguntas:

- Abrir un issue en GitHub
- Contactar al desarrollador principal
- Revisar la documentación en este README

---

**🔐 Death Switch v1.0** - Protegiendo tus datos más importantes
