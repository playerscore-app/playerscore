# PlayerScore

Aplicación web de análisis de partidos y jugadores de fútbol. Es una web estática: no necesita servidor propio, base de datos ni compilación.

## Archivos
- `index.html` — la aplicación completa (antes «Versión Beta»).
- `platform.js` — guardado de datos y descargas en el navegador (sustituye a lo que daba claude.ai).
- `favicon.svg` — icono.
- `package.json` — solo para arrancarla en local con `npm start`.

## Dónde se guardan los datos
En el propio navegador (IndexedDB), en el dispositivo donde se usa. No se envían a ningún sitio.
- Para pasar los datos a otro dispositivo o navegador: Plantilla → «Descargar copia de seguridad» y, en el otro, «Importar copia».
- Haz copias de seguridad a menudo: si se borran los datos del navegador, se pierden.
- En ventanas privadas no se guarda nada.

## Probar en local
Hay que abrirla desde un servidor local (no con doble clic en el archivo):

```
npm start            # abre en http://localhost:8080
# o, sin Node:
python3 -m http.server 8080
```

## Publicarla
Sirve cualquier alojamiento de webs estáticas. Se sube la carpeta tal cual:
- **Netlify:** app.netlify.com/drop → arrastrar la carpeta.
- **Vercel:** `npx vercel` dentro de la carpeta (sin configuración).
- **GitHub Pages:** subir la carpeta a un repositorio → Settings → Pages → rama principal, carpeta raíz.

Importante: no subas archivos de copia de seguridad (`copia-*.json`) a la web publicada; tienen datos de menores.

## Diferencias con la versión de claude.ai
- Los datos ya no se comparten entre dispositivos ni entre varias personas a la vez (llegará con usuarios y base de datos).
- Las preguntas con IA sobre los datos no están disponibles en la versión web.
- Todo lo demás funciona igual.
