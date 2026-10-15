# BOBC CRM Web v0.4

Web convencional mobile-first de BOBC SOFTWARE, situada en `docs/bobc-crm/` en la rama `main` del repositorio independiente BOBC-CRM. HTML, CSS, JavaScript ES6+ y JSON; sin TypeScript, manifest web ni service worker. Por petición posterior del usuario también se prepara un APK Android independiente, descrito en el README de la raíz. No modifica BOBC Artesanía.

## Estado real

IndexedDB local `bobc-crm`, versión 2: 96 entidades (51 originales y 45 ampliadas) y 115 referencias declaradas. La migración añade almacenes e índices y conserva los existentes. Una apertura bloqueada se cancela al desbloquearse; las conexiones se cierran ante `versionchange`.

Relaciones permite crear, buscar y convertir prospectos en clientes. Inicio y Reportes ofrecen resúmenes básicos y exportación CSV. Más contiene formularios genéricos de alta y consulta para las ocho áreas aprobadas: Proyectos, Contratos, Cobros, Gastos, Formularios, Presupuestos, Inventario y Proveedores. Estos formularios no sustituyen servicios de negocio completos.

El repositorio valida tipos de los campos suministrados, enteros monetarios seguros y referencias dentro de la transacción de escritura. La API ofrece actualización y eliminación protegida contra registros referenciados; todavía no hay interfaz completa de edición/baja por módulo. Las referencias polimórficas usan nombres de entidades del esquema; `audit_events` conserva identificadores históricos. No se ejecutan reglas ni expresiones JSON.

## Respaldos

- Los nuevos JSON usan `format: "BOBC-CRM-BACKUP"`, `backupVersion: 2` y `schemaVersion: 2`, con los 96 almacenes.
- La exportación lee todos los almacenes en una transacción para obtener un estado consistente.
- Si los datos históricos no superan la validación actual, la exportación conserva igualmente una copia de recuperación y añade `validation.passed: false` con el primer error; la interfaz avisa. La restauración no confía en esa marca y vuelve a validar todo.
- La restauración acepta originales v1 de 51 almacenes, v1 de transición de 96 (el exportador anterior indicaba versión 1) y v2 completos.
- Un v1 de 51 almacenes deja vacíos los 45 añadidos. Se rechaza si esos almacenes ya contienen datos, para evitar descartarlos.
- Restaurar reemplaza los datos locales tras la confirmación de la interfaz. La validación se completa antes de borrar; cualquier fallo durante la escritura revierte la transacción entera.
- Se rechazan formatos/versiones desconocidos, tablas parciales o ajenas al esquema, IDs inválidos/duplicados y referencias inexistentes o incompatibles.
- Los valores numéricos antiguos de `quantity`, `sort_order`, `version_number`, `expected_quantity` y `counted_quantity` se conservan al respaldar/restaurar; se normalizan a texto al editar. Metadatos antiguos no declarados se conservan, aunque las altas no aceptan campos desconocidos.

IndexedDB pertenece al navegador y al origen. Los JSON pertenecen al usuario. No hay backend, autenticación ni sincronización entre dispositivos.

## Verificación reproducible

Consulte [QA-REPORT.md](QA-REPORT.md) para resultados ejecutados, límites y decisión de auditoría. La guía recibida se conserva en [BOBC_CRM_DATASHEET_CODEX_v0.4.md](BOBC_CRM_DATASHEET_CODEX_v0.4.md).

Las pruebas emplean Python 3, Playwright y Chromium; estas herramientas son sólo de desarrollo, no dependencias de la aplicación. En un entorno de desarrollo:

```sh
python -m pip install playwright
python docs/bobc-crm/tests/run_browser_tests.py --chromium /usr/bin/chromium --json /tmp/bobc-crm-qa.json
```

El ejecutor usa un servidor local y contextos de navegador desechables; si el entorno restringe sockets, puede servir los archivos mediante rutas locales de Playwright. La página de pruebas está deshabilitada fuera de localhost y no ejecuta pruebas automáticamente. No abrir las pruebas con datos reales.

La emulación de tamaños Android/iPhone y escritorio en Chromium no acredita pruebas manuales en Android ni compatibilidad con Safari/iOS. La publicación web del repositorio independiente todavía no está configurada. El enlace del datasheet es la ubicación histórica, no una publicación de estos cambios.

## Pendiente

CRUD especializado y fichas vinculadas de Proyectos/Contratos; invariantes de cobros, presupuesto e inventario; controles de permisos; reportes avanzados, Kanban y formularios dinámicos. La auditoría P0 debe aprobarse antes de pasar a esos trabajos. No se declara cobertura global ni módulos productivos por el solo hecho de disponer de formularios.

