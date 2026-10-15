# QA-REPORT — BOBC CRM independiente 0.4.1

Fecha: 2026-10-15 UTC. Rama local: main. Repositorio remoto solicitado: BOBC-CRM, todavía pendiente de creación por el usuario.

El código web procede de jcarlospm05/Sistema-Artesanal-Android, commit 309278c9081dcf3aef672c7128f862f46555394b, más las correcciones P0 preparadas. El usuario autoriza expresamente aplicarlas pese a la auditoría de navegador pendiente y solicita un APK de CRM en un repositorio separado. BOBC Artesanía no se modifica.

## Resultado real

- 298 pruebas unitarias ejecutadas en Node: 298 aprobadas, 0 fallidas.
- Sintaxis de 13 archivos JS/MJS, runner Python, script Bash y estructura XML verificadas. Workflow YAML validado con parser.
- El nuevo adaptador de descarga se prueba con dobles explícitos de FileReader, DOM y callback nativo; esos casos no acreditan Android SAF.
- Chromium/IndexedDB: la ejecución local previa se bloqueó al iniciar Chromium por setsockopt EPERM. No se ejecutaron los casos de navegador.
- Compilación Android: NO EJECUTADA. El entorno tiene Java runtime, pero no javac, Gradle ni Android SDK; la conexión CLI tampoco está disponible.
- Android Lint, verificación de firma de APK y pruebas en un dispositivo: NO EJECUTADOS.
- Repositorio remoto, workflow y APK: PREPARADOS, todavía no publicados ni compilados.

No existe todavía un APK instalable generado por esta entrega. No se declara aptitud de producción ni porcentaje de cobertura global. La autorización para continuar no convierte las pruebas pendientes en aprobadas.

## Cambios de esta etapa

1. Proyecto local separado en /workspace/BOBC-CRM, con rama main.
2. Contenedor Android Java independiente: applicationId com.bobc.crm, versión 0.4.1 (401), Android 8.0 o posterior.
3. Assets web locales servidos por WebView desde un origen HTTPS propio, sin servidor ni PWA. No se empaquetan tests, informes ni datos reales.
4. Exportación JSON/CSV mediante ACTION_CREATE_DOCUMENT y restauración mediante ACTION_OPEN_DOCUMENT; sin permisos generales de almacenamiento. Guardado y cancelación se diferencian en la interfaz.
5. Puente limitado al documento local, MIME JSON/CSV, filename controlado, requestId y tamaño máximo de 32 MiB. Se bloquean recursos externos y navegación dentro del WebView fuera del documento permitido.
6. Compilación fijada a JDK 17, Gradle 8.9, Android plugin 8.7.3, SDK y build-tools 35. Gradle descargado se verifica con SHA-256 oficial.
7. Workflow independiente con unidades, navegador y compilación APK. El job APK exige unidades aprobadas; el estado del navegador se comunica por separado.
8. El script exige assembleDebug y lintDebug correctos, verifica el APK con apksigner y genera checksum antes de entregar el artefacto.

## Evidencias y reproducción

Resultados actuales: tests/results/node-qa.json. Evidencias históricas de P0: QA-P0-2026-10-14.md, tests/results/p0-node-qa.json y tests/results/browser-qa.json.

Desde la raíz:

```sh
node docs/bobc-crm/tests/node-tests.mjs --json /tmp/bobc-crm-node-qa.json
python docs/bobc-crm/tests/run_browser_tests.py --json /tmp/bobc-crm-browser-qa.json
bash scripts/build-apk.sh
```

Los dos últimos requieren un entorno que permita iniciar Chromium y/o tenga las herramientas Android indicadas. GitHub Actions los prepara cuando se publique el repositorio. BUILD-INFO.txt identifica el commit realmente compilado; no se sustituye esa identificación por el SHA del proyecto de Artesanía.

## Alcance y datos

Se mantienen IndexedDB bobc-crm, versión 2, 96 entidades, 115 referencias y las migraciones aditivas. Las limitaciones de los módulos genéricos y de las reglas financieras de la auditoría anterior permanecen vigentes.

La base del APK y la del navegador son independientes. Transferir datos requiere un JSON exportado por el usuario. Restaurar reemplaza los registros locales tras confirmación y validación; no se han acreditado aún las transacciones reales en esta entrega.

El APK de pruebas se firma con la clave debug del entorno de compilación. Para actualizar una instalación sin desinstalarla se requiere conservar la misma clave; una distribución estable necesita una firma propia fuera del repositorio. No hay claves ni credenciales en Git.

Antes de considerar el APK validado deben ejecutarse compilación, lint y firma, y probar creación, recarga, cierre/reapertura, exportación, cancelación y restauración en Android. Ninguna prueba simulada sustituye esas comprobaciones.

## Paso pendiente del usuario

Crear un repositorio vacío llamado BOBC-CRM y compartir su URL. La conexión GitHub actual dispone de escritura sobre repositorios existentes, pero no de una operación de creación. Con ese destino se podrá publicar el proyecto y ejecutar la compilación para obtener un APK real.
