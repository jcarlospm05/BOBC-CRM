# APK independiente de BOBC CRM

Este proyecto Android empaqueta el CRM de `../docs/bobc-crm/` en una aplicación
independiente llamada **BOBC CRM**, paquete `com.bobc.crm`, versión `0.4.1` (401).
Requiere Android 8.0 o posterior y Android System WebView actualizado. Usa sus
propios datos; no abre ni modifica la aplicación Sistema Artesanal.

La interfaz, el esquema y los módulos JavaScript se copian como assets durante
la compilación. `https://appassets.androidplatform.net/index.html` es el origen
local de esos assets, sin servidor ni permiso de Internet. El almacén IndexedDB
permanece dentro de los datos privados de BOBC CRM.

## Compilar

Se necesitan JDK 17, Gradle 8.9 y Android SDK Platform 35 con Build Tools 35.0.0.
Instala los paquetes y acepta sus licencias mediante Android Studio o:

```bash
sdkmanager "platforms;android-35" "build-tools;35.0.0" "platform-tools"
sdkmanager --licenses
export JAVA_HOME=/ruta/al/jdk-17
export ANDROID_HOME=/ruta/al/android-sdk
bash scripts/build-apk.sh
```

Ejecuta el último comando desde la raíz del repositorio BOBC-CRM. El script usa
Gradle 8.9 instalado o descarga esa versión a `.build-tools/` y verifica el
SHA-256 publicado por Gradle antes de ejecutarla. La primera compilación necesita
red para descargar Gradle y las dependencias del plugin Android 8.7.3.

Si `assembleDebug` y `lintDebug` terminan correctamente, la salida es:

- `dist/BOBC-CRM-0.4.1-debug.apk`
- `dist/BOBC-CRM-0.4.1-debug.apk.sha256`
- `android/app/build/reports/lint-results-debug.html`

El workflow de GitHub Actions del repositorio ejecuta el mismo script y entrega
el APK como artefacto descargable. Un repositorio remoto nuevo debe recibir estos
archivos antes de poder ejecutar el workflow.

## Instalar y conservar los datos

El APK de pruebas está firmado con una clave de depuración del entorno de
compilación. Android sólo permite actualizar una instalación con el mismo
paquete y la misma clave. Un runner nuevo puede generar una clave diferente;
no desinstales la versión anterior sin exportar primero su respaldo JSON. Para
publicar o distribuir actualizaciones estables se necesita una clave propia
guardada fuera del repositorio y una compilación `release` firmada.

Desinstalar la aplicación o borrar sus datos elimina el CRM local. No se habilita
el respaldo automático de Android; exporta y verifica respaldos JSON antes de
esas acciones. Los datos de la aplicación Artesanal se mantienen separados y no
se importan automáticamente.

## Documentos y permisos

Restaurar JSON abre el selector de documentos de Android. Exportar JSON o CSV
abre **Guardar como** mediante `ACTION_CREATE_DOCUMENT`; el usuario escoge el
destino, incluido un proveedor de nube si está instalado. No se solicitan permisos
generales de almacenamiento.

El puente JavaScript sólo acepta JSON o CSV, limita cada exportación a 32 MiB y
devuelve `bobc-file-result` con `requestId`, `success`, `name` y, cuando corresponde,
`error` o `cancelled`. El mensaje de guardado exitoso se emite después de escribir
y cerrar el documento. Si Android destruye la actividad durante el selector,
la exportación debe repetirse al volver a abrir la aplicación.

## Verificación pendiente

Revisar el código y ejecutar las pruebas JavaScript no sustituye compilar el
APK, ejecutar Android Lint ni probar el dispositivo. Antes de usar datos reales,
instala el artefacto de una compilación satisfactoria y comprueba crear/editar un
registro, cerrar y abrir la app, exportar y cancelar JSON/CSV, restaurar un
respaldo y repetirlo en modo avión. Verifica también teclado, rotación y botones
del sistema. Esta documentación no afirma que esas pruebas Android ya pasaron.
