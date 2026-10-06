# Gasolineras Disponibles

Sitio web estático, responsive y sin backend para consultar gasolineras y abrir la ubicación seleccionada directamente en Waze.

## Qué incluye

- Diseño mobile-first para Android, iPhone y computadora.
- Búsqueda instantánea por nombre, marca, dirección, municipio y departamento.
- Filtros automáticos según los campos presentes en el JSON.
- Orden por nombre, marca, municipio y departamento.
- Botón **IR CON WAZE**:
  - Usa `latitud,longitud` cuando ambas existen.
  - Si no hay coordenadas, usa la dirección codificada mediante `encodeURIComponent()`.
- Botón **Ver ubicación** usando OpenStreetMap.
- Vista **Lista / Mapa** con Leaflet + OpenStreetMap.
- Cálculo de distancia con Haversine cuando:
  1. el Excel contiene latitud/longitud, y
  2. el usuario pulsa **Mostrar gasolineras cercanas** y concede permiso.
- La ubicación del usuario no se guarda, no usa cookies y no se envía a un servidor por el código de la aplicación.
- Sin login, trackers ni backend.

## Estructura

```text
/gasolineras
├── index.html
├── styles.css
├── app.js
├── gasolineras.json
├── gasolineras.xlsx
├── convertir_excel.py
├── .nojekyll
├── README.md
└── assets/
    └── favicon.svg
```

## Datos actuales

`gasolineras.json` fue generado directamente del archivo `gasolineras.xlsx` entregado con este proyecto.

El Excel actual tiene hojas separadas para UNO y Shell. El convertidor las une en un solo JSON e infiere la marca a partir del nombre de la hoja cuando no existe una columna `MARCA`.

**Importante:** el Excel actual no contiene columnas de latitud y longitud. Por eso:
- Waze funciona usando la dirección.
- El mapa no inventa coordenadas ni geocodifica automáticamente.
- La opción de ordenar por cercanía se activa automáticamente en una futura actualización si agregas columnas `LATITUD` y `LONGITUD`.

## Cómo actualizar las gasolineras

1. Reemplaza `gasolineras.xlsx` por tu nuevo Excel.
2. Conserva encabezados razonables. El orden de columnas no importa y no es obligatorio que existan todas.
3. Desde una terminal, dentro de esta carpeta, ejecuta:

```bash
python convertir_excel.py
```

El script genera de nuevo:

```text
gasolineras.json
```

No necesitas modificar `index.html`, `styles.css` ni `app.js`.

### Encabezados reconocidos

El convertidor reconoce variantes comunes de:

- NOMBRE
- MARCA
- DIRECCION
- MUNICIPIO
- DEPARTAMENTO
- LATITUD
- LONGITUD
- CODIGO
- GRUPO / CATEGORIA
- OBSERVACIONES

Las columnas adicionales con encabezado se conservan en `extras`.

## Cómo se construye el enlace de Waze

Cuando hay coordenadas:

```text
https://waze.com/ul?ll=LATITUD,LONGITUD&navigate=yes
```

Cuando no hay coordenadas, se usa la dirección disponible:

```text
https://waze.com/ul?q=DIRECCION_CODIFICADA&navigate=yes
```

No se define manualmente un origen. Waze utiliza la ubicación actual del usuario como origen cuando inicia la navegación.

## Probar localmente

Por seguridad, los navegadores normalmente no permiten que `index.html` cargue `gasolineras.json` correctamente mediante `file://`.

Desde la carpeta del proyecto ejecuta:

```bash
python -m http.server 8000
```

Luego abre:

```text
http://localhost:8000
```

Para detenerlo, presiona `Ctrl+C`.

---

# Publicar gratis

## Opción A — Cloudflare Pages (Direct Upload)

Esta opción no requiere backend ni instalar una aplicación en el teléfono.

1. Crea o inicia sesión en una cuenta gratuita de Cloudflare.
2. En el panel de Cloudflare, entra a **Workers & Pages**.
3. Crea un proyecto de **Pages** mediante **Direct Upload**.
4. Elige un nombre, por ejemplo `mis-gasolineras`.
5. Sube el contenido de esta carpeta (o el ZIP del proyecto si la interfaz lo permite).
6. Cloudflare publicará el sitio con una dirección similar a:

```text
https://mis-gasolineras.pages.dev
```

Para actualizarlo posteriormente, regenera `gasolineras.json` y realiza un nuevo Direct Upload.

Documentación oficial:
https://developers.cloudflare.com/pages/get-started/direct-upload/

## Opción B — GitHub Pages

1. Crea una cuenta gratuita en GitHub si no tienes una.
2. Crea un repositorio público, por ejemplo `gasolineras`.
3. Sube **el contenido de esta carpeta a la raíz del repositorio**.
4. En el repositorio abre:
   **Settings → Pages**.
5. En **Build and deployment**, selecciona:
   - **Source:** `Deploy from a branch`
   - **Branch:** `main`
   - **Folder:** `/(root)`
6. Guarda la configuración.
7. Después del despliegue tendrás un enlace similar a:

```text
https://TU-USUARIO.github.io/gasolineras/
```

Para actualizar los datos:
1. reemplaza `gasolineras.xlsx`,
2. ejecuta `python convertir_excel.py`,
3. sube el nuevo `gasolineras.json` (y opcionalmente el Excel) al repositorio.

Documentación oficial:
https://docs.github.com/en/pages/getting-started-with-github-pages/configuring-a-publishing-source-for-your-github-pages-site

## Privacidad

- No hay login.
- No hay cookies.
- No hay analytics ni rastreadores.
- La aplicación no almacena la ubicación del usuario.
- La geolocalización solo se solicita cuando el usuario pulsa **Mostrar gasolineras cercanas**.
- El cálculo de Haversine ocurre localmente en JavaScript.
- La ubicación del usuario no se agrega a los enlaces de Waze ni se envía por el código de esta web.
- Leaflet/OpenStreetMap solo se utiliza para visualizar coordenadas públicas de las gasolineras.
