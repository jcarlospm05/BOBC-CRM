# Pruebas reproducibles

## Validación de funciones con Node

Con Node 24 o posterior, desde la raíz del repositorio:

```sh
node docs/bobc-crm/tests/node-tests.mjs --json /tmp/bobc-crm-node-qa.json
```

Esta suite no necesita paquetes externos. Importa las funciones reales de esquema,
validación de respaldos, relaciones, CSV y conversión de campos. Usa los archivos
JSON reales con `fetch` simulado; sus respuestas correctas, no disponibles y JSON
inválido se simulan explícitamente. Comprueba las 96 entidades y las 115 FK, respaldos
v1 de 51/96 tablas y v2, referencias polimórficas y pertenencia entre registros,
preservación de campos históricos, límites numéricos y protección CSV contra fórmulas.

**No ejecuta IndexedDB nativo, migraciones, CRUD de base de datos, persistencia,
interfaz, navegador, red ni deployment.** Sus aprobaciones no sustituyen las pruebas
de navegador siguientes. El JSON indica cada caso ejecutado y su resultado.

## Auditoría en navegador

El runner utiliza un servidor HTTP efímero de la biblioteca estándar de Python y
Chromium con contextos temporales de Playwright. No añade un backend al producto,
no accede a IndexedDB de GitHub Pages y no guarda datos reales.
La página de pruebas y el módulo JS rechazan su ejecución fuera de localhost;
abrirlos en Pages no ofrece las operaciones destructivas de la suite.

Requisitos de pruebas: Python 3, paquete Python `playwright` y Chromium instalado.
En un entorno nuevo se puede instalar el paquete con `python -m pip install playwright`.
El navegador de sistema se selecciona con `--chromium /ruta/al/chromium`; si no existe,
Playwright también puede instalar Chromium con `python -m playwright install chromium`
y se debe pasar la ruta de su ejecutable. Estas dependencias sólo ejecutan pruebas.

Desde la raíz del repositorio:

```sh
python docs/bobc-crm/tests/run_browser_tests.py --json /tmp/bobc-crm-qa.json
```

El primer run intenta cargar la URL pública durante un máximo de 15 segundos,
usando el proxy HTTPS del entorno cuando exista. `--skip-public` evita repetir
esa comprobación al depurar pruebas locales. La indisponibilidad de red queda
registrada como no ejecutada; no se presenta como verificación de Pages.
Si el entorno impide abrir el servidor local, el runner sirve los mismos archivos
con rutas de Playwright en un origen localhost virtual, indicado en `transport`.
Si Chromium tampoco puede iniciarse, informa `executionError`, cero pruebas
ejecutadas y código de salida 1; nunca interpreta ese bloqueo como aprobación.

Las pruebas comprueban los 96 almacenes y 115 FK declaradas, una migración v1→v2
real con registros en las 51 tablas originales, índices existentes, bloqueos y
cierre por `versionchange` entre dos páginas, FK estáticas/polimórficas, borrado
protegido, instantánea consistente de exportación y compatibilidad de respaldos
v1 (51/96 tablas) y v2. Archivos inválidos y una transacción abortada deben
preservar la base. Los recorridos de interfaz cubren 5 pestañas, 8 áreas/37
formularios, relación→cliente, búsqueda, altas vinculadas, JSON/CSV y persistencia.

Android Pixel 7 (393×851), iPhone 13 (390×664) y escritorio (1280×900) se emulan
explícitamente en Chromium. **No son pruebas en dispositivos reales ni Safari**.
Los tests no certifican reglas financieras, Kanban, permisos, sincronización o
CRUD especializado aún pendiente. El JSON informa cada caso aprobado/fallido,
versión de Chromium y el commit base; las modificaciones locales se prueban sobre
esa base. No es una medida de cobertura de código ni de todos los procesos de negocio.
