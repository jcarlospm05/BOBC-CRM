# BOBC CRM — repositorio independiente

Este repositorio contiene exclusivamente BOBC CRM. BOBC Artesanía permanece en Sistema-Artesanal-Android y no se modifica desde aquí.

La petición posterior del usuario autoriza explícitamente separar los repositorios y construir un APK independiente. Esa petición sustituye la prohibición histórica de APK del datasheet recibido. El CRM web conserva HTML, CSS, JavaScript ES6+, JSON e IndexedDB; Android sólo aporta el contenedor Java y los selectores de documentos.

- Web: docs/bobc-crm/. Android: android/. Compilación: scripts/ y .github/workflows/.
- Mantener DB_NAME=bobc-crm, versión 2, 96 entidades y 115 referencias; migraciones aditivas.
- No introducir TypeScript, backend obligatorio, SQL, PWA ni service worker.
- No publicar claves, contraseñas, keystores ni credenciales.
- Los datos del APK son independientes de los del navegador. La transferencia se realiza mediante JSON explícito del usuario.
- Documentar por separado pruebas unitarias, navegador/IndexedDB, compilación APK y pruebas Android reales. No presentar emulación o callbacks simulados como validación de un dispositivo.
- El usuario solicita aplicar los cambios pese a la auditoría de navegador pendiente; conservar esa limitación en QA y etiquetar el APK como edición de pruebas.
