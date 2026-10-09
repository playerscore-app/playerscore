# PlayerScore

Aplicación web de análisis de partidos y jugadores de fútbol. Es una web estática y los datos se guardan en Supabase (plan gratuito), con una cuenta por usuario.

## Archivos
- `index.html`: la aplicación.
- `platform.js`: cuentas, guardado de datos y descargas.
- `config.js`: **aquí se pegan la URL y la clave de Supabase.**
- `supabase/schema.sql`: crea la tabla y las reglas de seguridad (cada usuario solo ve sus datos).
- `favicon.svg`, `package.json` (para `npm start` en local).

Si `config.js` está vacío, la app funciona sin cuentas y guarda los datos solo en el navegador.

## Puesta en marcha (una vez)
1. **Crear el proyecto:** supabase.com → Start your project (entrar con GitHub o correo) → New project. Nombre `playerscore`, región *West EU (Ireland)* o *Central EU (Frankfurt)*, contraseña de la base de datos (guárdala).
2. **Crear la tabla:** SQL Editor → New query → pegar todo `supabase/schema.sql` → Run. Tiene que decir *Success*.
3. **Correo de confirmación:** Authentication → Sign In / Providers → Email → desactivar **Confirm email** → Save.
   El correo gratuito de Supabase solo envía a los miembros de tu equipo de Supabase. Sin este cambio, la gente no podría confirmar su cuenta.
4. **Dirección de la web:** Authentication → URL Configuration → *Site URL* = la dirección de tu web publicada (p. ej. `https://playerscore.netlify.app`). Añádela también en *Redirect URLs*.
5. **Claves:** botón **Connect** (arriba en el panel) o Project Settings → API Keys. Copia la *Project URL* y la clave **publishable** (`sb_publishable_…`; vale también la antigua *anon public*). Pégalas en `config.js`.
   No uses nunca la clave *secret* ni *service_role* en la web.
6. **Volver a publicar** la carpeta (igual que la primera vez).
7. Entra en la web → «Crear cuenta» → Plantilla → «Importar copia» con tu copia de seguridad.

## Recuperar contraseña (opcional, recomendable)
El enlace «¿Has olvidado la contraseña?» necesita enviar correos a cualquier dirección. Para eso hay que conectar un servicio de correo gratuito:
- Crea una cuenta en Brevo (gratis, 300 correos al día).
- En Supabase: Authentication → Emails → SMTP Settings, con los datos SMTP de Brevo.

Con el correo ya configurado, puedes volver a activar *Confirm email* si quieres verificar los correos.

## Límites del plan gratuito de Supabase
- 500 MB de base de datos. Un partido completo ocupa unos 100 KB, así que hay sitio para miles de partidos.
- 50.000 usuarios activos al mes.
- **El proyecto se pausa tras 1 semana sin uso.** Se reactiva desde el panel de Supabase (botón *Restore*). Los datos no se pierden.

## Cómo funciona
- Cada persona crea su cuenta con correo y contraseña. Solo ve sus datos: lo garantizan las reglas de la base de datos, no solo la app.
- Con la misma cuenta en varios dispositivos se ven los mismos datos. Los cambios llegan en directo.
- Para que varias personas trabajen con los mismos datos, de momento deben usar la misma cuenta.
- Copia de seguridad, importar, Excel y PDF funcionan igual que antes.
- Las preguntas con IA siguen sin estar disponibles en la versión web.

## Probar en local
```
npm start            # http://localhost:8080
# o: python3 -m http.server 8080
```
