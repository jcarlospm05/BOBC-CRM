# QA-REPORT — BOBC CRM independiente 0.4.1

Fecha: 2026-10-15 UTC. Repositorio: [jcarlospm05/BOBC-CRM](https://github.com/jcarlospm05/BOBC-CRM), rama main.

**Código compilado y probado:** `5b6beeb869b0c51c75e12ed99743fde0acefa354`.  
**Ejecución final:** [38664838490](https://github.com/jcarlospm05/BOBC-CRM/actions/runs/38664838490), completada con **success**.  
**Decisión:** **APTO para entregar el APK de pruebas**. No se certifican uso productivo, reglas financieras ni funcionamiento en un dispositivo Android real.

## Resultado ejecutado

| Verificación | Resultado | Evidencia |
|---|---|---|
| Validaciones JavaScript | 298 ejecutadas, 298 aprobadas, 0 fallidas | Job 116194267034; artefacto BOBC-CRM-unit-QA |
| Chromium e IndexedDB reales | 25 ejecutadas, 25 aprobadas, 0 fallidas | Job 116194267355; artefacto BOBC-CRM-browser-QA |
| Assets CRM y assembleDebug | BUILD SUCCESSFUL | Job 116194303829 |
| Android Lint | lintDebug completado correctamente | Mismo job |
| Firma instalable | apksigner: Verifies; esquema v2 true | Mismo job |
| Archivo entregable | BOBC-CRM-0.4.1-debug.apk, checksum y BUILD-INFO.txt | Artefacto APK 11940925255 |
| Dispositivo Android y selector SAF real | NO EJECUTADO | Pendiente de prueba manual |
| URL web de Pages independiente | NO EJECUTADO | El workflow de navegador usa --skip-public; no se configura hosting web |

Los resultados locales previos no se confunden con la ejecución remota. El bloqueo local setsockopt EPERM quedó registrado en la auditoría histórica, pero las pruebas de navegador sí se ejecutaron posteriormente en GitHub Actions.

## Cobertura funcional real

Las pruebas de navegador comprueban BD nueva con 96 almacenes e índices; migración aditiva 1→2 conservando contenido e índices de los 51 originales; las 115 referencias; rechazo atómico de FK inválidas; actualización/baja protegida; referencias polimórficas y compatibilidad entre padres; cierre y reapertura; bloqueo y versionchange entre dos páginas.

También comprueban exportación consistente; v2→base limpia con comparación de IDs/contenido; respaldo original v1 de 51 tablas y v1 transicional de 96; preservación de campos históricos; rechazo de archivos inválidos; protección de módulos ocupados ante un original51; exportación de recuperación y rollback tras un fallo de escritura.

Los recorridos UI cubren cinco pestañas, ocho áreas, 37 formularios genéricos, búsqueda/conversión de Relaciones, altas vinculadas, descarga/importación JSON, CSV y persistencia. Pixel 7, iPhone 13 y escritorio son **emulaciones de viewport en Chromium**, no dispositivos reales ni Safari.

Las 298 unidades incluyen validadores y el adaptador JS de descarga con dobles explícitos de FileReader/DOM/callback. Ese adaptador simulado no certifica el selector de documentos Android.

## Hallazgos resueltos durante CI

- Primera ejecución: el instalador Android solicitaba el paquete obsoleto tools. Se configuró platform-tools y después SDK/build-tools 35.
- Segunda ejecución: el caso de migración falló por una conexión de pruebas todavía ocupada. Las comprobaciones de índices no esperaban a que sus transacciones finalizaran antes de cerrar y borrar la BD. Se corrigió la limpieza sin eliminar ninguna comprobación de migración o de bloqueo.
- El informe de navegador identificaba un SHA histórico fijo. Ahora utiliza GITHUB_SHA para el código de CI y conserva el SHA original por separado.
- La última ejecución pasó todos los jobs. No se presentan los intentos anteriores fallidos como aprobados.

El núcleo web incorpora las correcciones P0 documentadas en [QA-P0-2026-10-14.md](QA-P0-2026-10-14.md). Se mantienen bobc-crm, versión 2, 96 entidades, 115 referencias y migraciones aditivas.

## Entrega y reproducción

[Descargar APK directamente](https://github.com/jcarlospm05/BOBC-CRM/releases/download/v0.4.1/BOBC-CRM-0.4.1-debug.apk). Publicado como versión de pruebas [v0.4.1](https://github.com/jcarlospm05/BOBC-CRM/releases/tag/v0.4.1).

SHA-256 del APK individual: `7c6d7891266f7e922bae28768d3b6903760327be917d86fd8fbdb50d4a6ad30b`. La [publicación 38666083366](https://github.com/jcarlospm05/BOBC-CRM/actions/runs/38666083366) comprobó la ejecución de origen, el commit compilado y el checksum del archivo antes de adjuntarlo a la versión.

[Descargar APK de pruebas (ZIP)](https://github.com/jcarlospm05/BOBC-CRM/actions/runs/38664838490/artifacts/11940925255).

El ZIP contiene el APK firmado, su archivo SHA-256 y BUILD-INFO.txt con el commit compilado. SHA-256 del ZIP publicado por GitHub: `589f0c1f840c3a15b43230fdf9289766604c96761c09432bb8f7ae4a010a7eff`. Esta huella corresponde al ZIP, no al APK individual.

Artefactos de [unidades](https://github.com/jcarlospm05/BOBC-CRM/actions/runs/38664838490/artifacts/11940666656) y [navegador](https://github.com/jcarlospm05/BOBC-CRM/actions/runs/38664838490/artifacts/11940288246). El workflow y los artefactos identifican el código probado; los JSON históricos de tests/results se conservan como evidencia anterior.

Desde la raíz, con las herramientas indicadas en README:

```sh
node docs/bobc-crm/tests/node-tests.mjs --json /tmp/bobc-crm-node-qa.json
python docs/bobc-crm/tests/run_browser_tests.py --json /tmp/bobc-crm-browser-qa.json
bash scripts/build-apk.sh
```

## Android, datos y límites

La aplicación independiente es com.bobc.crm, versión 0.4.1 (401), para Android 8.0 o posterior con WebView actualizado. Contiene assets locales; no es una PWA, no instala un servidor y no incorpora BOBC Artesanía. No se empaquetan pruebas, informes ni datos reales.

Exportar JSON/CSV utiliza ACTION_CREATE_DOCUMENT; restaurar JSON utiliza ACTION_OPEN_DOCUMENT. Se controlan MIME, nombre, tamaño de 32 MiB y requestId; cancelar el destino no se anuncia como guardado correcto. Esas operaciones requieren comprobación en Android real.

El APK y el navegador usan espacios de almacenamiento diferentes. Para transferir datos se debe conservar un JSON de la web e importarlo en el APK. Desinstalar o borrar datos de Android elimina el almacén local.

La firma debug es de pruebas. Para actualizaciones estables sin desinstalación debe conservarse la misma clave en un entorno privado; no hay claves ni credenciales en el repositorio. La distribución de este APK no sustituye configurar una firma release propia.

Los formularios genéricos no equivalen a CRUD especializado ni a invariantes de pagos, presupuesto o inventario. No hay backend, autenticación ni sincronización multidispositivo. No se declara cobertura global ni porcentaje de calidad.

BOBC Artesanía permanece en su repositorio anterior. La documentación de esta entrega se publica después de la compilación y referencia explícitamente el commit que generó el APK.
