# BOBC CRM 0.4.1

Repositorio independiente del CRM de BOBC SOFTWARE, separado de BOBC Artesanía por petición del usuario. El código web incorpora las correcciones P0 de respaldos v1/v2, migración aditiva, validación de referencias, formularios y exportación CSV.

## Descargar APK

[BOBC CRM 0.4.1 — APK de pruebas para Android 8+](https://github.com/jcarlospm05/BOBC-CRM/releases/download/v0.4.1/BOBC-CRM-0.4.1-debug.apk).

Compilación, Android Lint y firma verificados; 298 pruebas unitarias y 25 pruebas de navegador aprobadas. Las pruebas en un dispositivo Android real siguen pendientes. Consulte [el informe QA](docs/bobc-crm/QA-REPORT.md) y conserve un respaldo JSON para transferir datos desde la web.

## Contenido

- `docs/bobc-crm/`: aplicación HTML/CSS/JavaScript y JSON. IndexedDB bobc-crm, versión 2, 96 entidades y 115 referencias.
- `android/`: aplicación Android independiente `com.bobc.crm`, con el CRM empaquetado para uso local.
- `scripts/build-apk.sh`: compilación reproducible de un APK firmado de pruebas y comprobación de firma.
- `.github/workflows/build-crm.yml`: pruebas y compilación en GitHub Actions, con el APK como artefacto descargable.

El APK abre los archivos incluidos en la aplicación, sin instalar un servidor ni depender de la web de Artesanía. Exportar JSON/CSV abre el selector de destino de Android; restaurar JSON permite escoger un documento. Cancelar el selector no se presenta como un guardado exitoso.

## Compilar y descargar

Con JDK 17, SDK Android 35, build-tools 35.0.0 y Gradle 8.9:

```sh
bash scripts/build-apk.sh
```

La salida se encuentra en `dist/`. GitHub Actions prepara esas herramientas automáticamente y publica un artefacto llamado `BOBC-CRM-0.4.1-APK-pruebas`. No se entrega un APK sin firmar como instalable. La edición debug usa la firma de pruebas del entorno de compilación; para actualizaciones de distribución se necesita configurar una firma estable y conservarla fuera del repositorio.

## Datos existentes

Android y el navegador almacenan sus datos en espacios separados. Para transferirlos: exportar un JSON desde la web, conservar el original y restaurarlo en el APK. El nuevo repositorio no contiene registros reales del usuario. No desinstalar una aplicación con datos sin conservar un respaldo.

## Verificación y alcance

```sh
node docs/bobc-crm/tests/node-tests.mjs --json /tmp/bobc-crm-node-qa.json
python docs/bobc-crm/tests/run_browser_tests.py --json /tmp/bobc-crm-browser-qa.json
```

Los resultados y pendientes se indican en [QA-REPORT.md](docs/bobc-crm/QA-REPORT.md). Compilar un APK no acredita la recuperación de datos ni el funcionamiento en un dispositivo Android. Los callbacks del selector de documentos simulados en Node tampoco lo acreditan.

La aplicación sigue siendo un prototipo: los formularios genéricos no equivalen a CRUD especializado ni a cálculos financieros, contabilidad o inventario certificados. No hay backend ni sincronización multidispositivo.
