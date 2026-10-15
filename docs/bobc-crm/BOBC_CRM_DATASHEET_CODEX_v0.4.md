# BOBC CRM — Datasheet maestro para continuidad en Codex
**Edición:** v0.4 · **Fecha:** 2026-10-14 · **Estado:** prototipo web, desarrollo activo

> Este archivo es el documento de transferencia a Codex. **La fuente de verdad del código y del esquema es el repositorio GitHub**, no los paquetes ZIP anteriores, que pueden contener versiones preliminares diferentes. No sustituir el esquema publicado por copias antiguas.

## 1. Identidad del producto
- **Producto:** BOBC CRM, de BOBC SOFTWARE.
- **Objetivo:** CRM generalista, modular y adaptable a profesionales independientes y pequeñas empresas de cualquier actividad, con experiencia inspirada funcionalmente en Zoho CRM, sin copiar código ni identidad gráfica.
- **Filosofía BOBC-FIL-001:** resolver necesidades reales de manera simple, accesible y económicamente viable; evitar un ERP innecesariamente complejo.
- **Canal principal:** WEB convencional responsive y mobile-first, para Android/iPhone desde navegador; escritorio en segundo plano. **NO PWA**, NO APK, NO instalación obligatoria, NO service worker, NO manifest web.
- **Tecnologías autorizadas:** HTML5, CSS, JavaScript ES6+ modular, JSON, IndexedDB; bibliotecas JS/CSS compatibles cuando estén justificadas. **No TypeScript (.ts/.tsx)**.
- **Diseño:** tarjetas redondeadas, menú móvil inferior, cabecera simple; colores Denim `#173B61`, Deep Turquoise `#2F606B`, Grey Blue `#7D959E`, Orange `#EE8E3B`, Pure `#FCECD4`.
- **Objetivo comercial:** futura suite de módulos opcionales y productos independientes basados en componentes reutilizables. Evitar código monolítico.

## 2. Repositorio, entorno y publicación
- **GitHub:** https://github.com/jcarlospm05/Sistema-Artesanal-Android
- **Rama activa:** `main`.
- **Ubicación exacta del proyecto:** `docs/bobc-crm/`.
- **Web:** https://jcarlospm05.github.io/Sistema-Artesanal-Android/bobc-crm/
- **Despliegue:** GitHub Actions, workflow `.github/workflows/pages.yml`, sube `./docs` a GitHub Pages. **No modificar `docs/index.html` ni los archivos de BOBC Artesanía**.
- **Almacenamiento:** IndexedDB local en el origen web, `bobc-crm`, sin backend ni sincronización multidispositivo. Los archivos JSON de respaldo pertenecen al usuario.
- **Advertencia:** los cambios en GitHub pueden tardar en aparecer en Pages; probar versión desplegada además de la rama.

## 3. Estructura efectivamente publicada (revisada en GitHub)
```text
 docs/bobc-crm/
 ├── index.html
 ├── css/theme.css
 ├── data/
 │   ├── schema.json                  # 51 entidades originales
 │   └── schema-extension-v2.json     # 45 entidades añadidas
 ├── js/
 │   ├── app.js                       # navegación, dashboard básico, relaciones, informes básicos
 │   ├── core/
 │   │   ├── schema.js                # carga y validación estructural, versión de BD 2
 │   │   ├── idb.js                   # apertura y migración aditiva de almacenes/índices
 │   │   ├── repository.js            # CRUD básico y comprobación de FK en guardado
 │   │   └── backup.js                # respaldo/restauración original; AUDITAR compatibilidad v2
 │   └── modules/
 │       ├── relationships/party-service.js
 │       └── module-manager.js        # editor genérico de nuevas entidades
 └── README.md                        # ATENCIÓN: README aún contiene referencia antigua v0.3.1
```
**Nota:** El README publicado puede estar desactualizado. Consultar siempre los archivos fuente actuales para saber qué está implementado.

## 4. Modelo de datos
- **IndexedDB:** nombre `bobc-crm`, versión **2**.
- **Entidad lógica ≈ object store** con `keyPath: 'id'`, identificador UUID, `created_at`, `updated_at`.
- **Entidades:** **96** = 51 iniciales + 45 ampliación.
- **Referencias lógicas:** **115** = 48 iniciales + 67 nuevas. Las referencias se expresan en los esquemas como `campo_fk: 'entidad_destino.id'`.
- **Importante:** IndexedDB **no implementa claves foráneas SQL**; validarlas explícitamente en servicios y transacciones. No confundir existencia de 115 referencias de esquema con integridad referencial auditada en todos los CRUD.
- **Índices:** se crean para campos de referencia y timestamps, según `idb.js`. Evaluar índices compuestos al crecer las consultas.
- **Regla de migración:** `onupgradeneeded` debe añadir almacenes/índices faltantes **sin eliminar, limpiar ni renombrar los 51 originales**. Versionar toda migración; prever versiones futuras y bloqueos de otras pestañas.

### 4.1. Ocho nuevos módulos aprobados — entidades añadidas
| Módulo | Entidades funcionales | Entidad configuración | Total |
|---|---|---|---:|
| Proyectos | `projects`, `project_phases`, `project_tasks`, `project_milestones`, `project_deliverables` | `module_projects` | 6 |
| Contratos | `contracts`, `contract_parties`, `contract_terms`, `contract_revisions`, `contract_renewals` | `module_contracts` | 6 |
| Cuentas por cobrar | `receivables`, `receivable_installments`, `receivable_payments`, `payment_allocations`, `collection_followups` | `module_receivables` | 6 |
| Gastos | `expense_categories`, `expenses`, `expense_items`, `expense_attachments` | `module_expenses` | 5 |
| Formularios | `form_submissions`, `form_answers`, `form_rules` | `module_forms` | 4 |
| Presupuestos | `budgets`, `budget_lines`, `budget_versions`, `budget_actuals` | `module_budgets` | 5 |
| Inventario | `warehouses`, `inventory_items`, `inventory_lots`, `inventory_movements`, `stock_counts`, `stock_count_lines` | `module_inventory` | 7 |
| Proveedores | `suppliers`, `purchase_orders`, `purchase_order_lines`, `supplier_contacts`, `supplier_prices` | `module_suppliers` | 6 |
| **Total** | **37 entidades funcionales** | **8 configuraciones** | **45** |

### 4.2. Relaciones entre áreas — ejemplos del esquema publicado
- `projects.party_id → parties.id`; `projects.opportunity_id → opportunities.id`.
- `project_tasks.project_id → projects.id`; `project_tasks.phase_id → project_phases.id`.
- `contracts.party_id → parties.id`; `contracts.project_id → projects.id`.
- `receivables.party_id → parties.id`; `receivables.sale_id → sales_orders.id`; `receivables.contract_id → contracts.id`.
- `receivable_payments.receivable_id → receivables.id`; `payment_allocations.payment_id → receivable_payments.id`.
- `expenses.project_id → projects.id`; `expenses.supplier_id → suppliers.id`.
- `form_submissions.form_definition_id → form_definitions.id` (reutiliza formularios originales).
- `budgets.project_id → projects.id`; `budget_actuals.expense_id → expenses.id`.
- `inventory_items.catalog_item_id → catalog_items.id`; `inventory_movements.warehouse_id → warehouses.id`.
- `suppliers.party_id → parties.id`; `purchase_orders.supplier_id → suppliers.id`.

### 4.3. Consideraciones de modelado críticas
- Cliente/persona/empresa: mantener la entidad base `parties`, evitando contactos y proveedores duplicados.
- Reutilizar `catalog_items`, `opportunities`, `activity_items`, `users`, `form_definitions`, `field_definitions`.
- Los ocho `module_*` son **registros de configuración**, no sustituyen las entidades transaccionales.
- Importes monetarios: unidad mínima (`*_minor`), nunca flotantes de moneda. Aclarar moneda por documento y reglas de redondeo.
- Inventario: movimientos inmutables o compensatorios, sin editar saldos históricos arbitrariamente; reconciliación de lotes, almacenes y conteos.
- Cobros: suma de aplicaciones, pagos y saldo debe cuadrar; validación de pagos parciales, excesos, anulaciones y reversos.
- Contratos, presupuestos y ventas: versionado/snapshots de conceptos para preservar historial.
- Formularios: no ejecutar expresiones arbitrarias recibidas en JSON; definir reglas declarativas seguras.
- **No deducir obligatoriedad** de un campo por el nombre. Definir validación por operación, contexto y estado.

## 5. Estado funcional real
**Probado manualmente por el usuario en Android:** navegación de los 5 botones del footer; alta de cliente mediante `+`; persistencia básica tras recargar.

**Implementado a nivel inicial en el código:** menú Inicio / Relaciones / Negocios / Reportes / Más; resumen de clientes y prospectos; búsqueda y conversión de relaciones; exportación JSON, restauración original; resumen y exportación CSV básica; editor genérico en Más para 8 áreas (formularios derivados del esquema, lectura y altas vinculadas).

**Pendiente de certificación funcional:** migración IndexedDB v1→v2 en dispositivo real; integridad de 115 referencias ante todas las operaciones; actualización y eliminación controlada de entidades; pruebas de exportación/importación de 96 almacenes; gestión de permisos; validación avanzada; pruebas funcionales de formularios genéricos; pruebas multipestaña.

**Aún NO implementado de forma completa:** gestión especializada de proyectos/contratos/cobros/gastos/formularios/presupuestos/inventario/proveedores; facturación/contabilidad; workflows financieros; informes con Query Builder visual avanzado; Kanban completo; sincronización de datos entre dispositivos; backend/autenticación. No afirmar que un módulo es productivo sólo por existir su entidad o formulario genérico.

### Alerta especial: respaldos v0.4
El archivo publicado `js/core/backup.js` es el motor original. **Revisar antes de usar restauración de datos de v0.3 contra v0.4:** sus reglas pueden exigir coincidencia de `schemaVersion` y todas las tablas actuales, lo que impediría restaurar correctamente un respaldo de 51 entidades sobre uno de 96. En Codex, crear un motor de respaldo versionado y pruebas de ida/vuelta para ambas versiones **antes de anunciar compatibilidad de backups**.

## 6. Reglas permanentes para Codex
1. **ARQ-001 — modularidad extrema:** archivos cortos, una responsabilidad por módulo, servicios + repositorios + UI separados; evitar modificar archivos no relacionados.
2. **ARQ-002 — tecnologías:** sólo HTML/CSS/JS/JSON y dependencias JS compatibles; prohibido introducir TypeScript, frameworks obligatorios, servidor o base de datos SQL como dependencia de ejecución sin aprobación.
3. **ARQ-003 — universalidad:** nada de campos o procesos obligatorios exclusivos de una industria; personalización por entidades/módulos.
4. **ARQ-004 — web mobile-first:** navegador móvil como primera plataforma, responsive; NO PWA ni APK. No registrar service worker.
5. **ARQ-005 — extensibilidad:** cada ampliación aporta esquema, migración aditiva, UI/servicio y pruebas; no romper módulos existentes.
6. **Integridad:** no aceptar FK inventadas; impedir borrar registros referenciados o utilizar soft-delete cuando proceda; verificar referencias polimórficas.
7. **Versionado:** mantener compatibilidad de datos, separar cambios de esquema y de interfaz; no ejecutar migración destructiva sin consentimiento explícito.
8. **Seguridad:** ninguna credencial en el repositorio; sanitizar texto HTML; evitar interpolaciones inseguras; copias de seguridad verificables; no afirmar cifrado/privacidad que no existe.
9. **Conservación:** los datos en IndexedDB pertenecen al origen web; cambiar dominio/ruta/origen puede alterar accesibilidad; no crear nueva base innecesaria.
10. **Auditoría obligatoria en cada cambio:** pasar pruebas estructurales, sintaxis, relaciones, funcionales, regresión, persistencia y respaldo; entregar informe reproducible y detallar fallos y límites.

## 7. Protocolo de auditoría obligatorio (por implementación)
**A. Inspección previa**
- Leer HEAD de `main`, detectar versión actual del esquema y archivos afectados, revisar estado de GitHub Pages.
- Crear matriz de requisitos → entidad/campo → servicio → pantalla → prueba.

**B. Esquema y relaciones**
- Contar entidades, IDs únicos, referencias existentes y tipos válidos.
- Detectar ciclos problemáticos, deletes en cascada no previstos, huérfanos, relaciones cruzadas incompatibles, duplicados.
- Ejecutar migración sobre BD de prueba v1 con datos ficticios y verificar igualdad antes/después de tablas originales.

**C. CRUD y reglas de negocio**
- Prueba de alta, lista, búsqueda, edición, baja/archivo para cada entidad expuesta.
- Campos obligatorios, FKs válidas e inválidas, fechas, montos, estados y casos límite.
- Pruebas negativas de saldo, sobregiro de pagos y existencias, dependiendo del módulo.

**D. UI y regresión**
- Navegación sin controles inertes, botones accesibles, formularios completos y estados vacíos/errores.
- Verificación en móvil Android y viewport iPhone/desktop, y carga mediante URL desplegada.
- Repetir smoke tests de Relaciones, footer, JSON y reportes.

**E. Persistencia y recuperación**
- Guardar → recargar → cerrar/abrir → recuperar; abrir múltiples pestañas al migrar.
- Exportar JSON v2 → importar sobre base limpia → comparar conjuntos por ID y contenido; validar backups v1.
- Confirmar que falla con seguridad ante archivo inválido, parcial o corrupto.

**F. Informe**
Entregar `QA-REPORT.md` con: fecha, commit SHA, cambios, pruebas ejecutadas/aprobadas/fallidas/no ejecutadas, hallazgos por severidad, cobertura real, riesgo de datos y decisión APTO/NO APTO. **No declarar ≥95 % sin pruebas medibles.**

## 8. Backlog recomendado y orden de trabajo
**P0 (bloqueantes)**: reparar/validar backup v1-v2 y migraciones; crear pruebas automáticas de IndexedDB; revisar seguridad del repositorio y gestor genérico; actualizar README.
**P1**: Relaciones completas (teléfono, correo, direcciones, notas, etiquetas); proyectos CRUD + fases + tareas; contratos CRUD vinculados; pantalla de módulos usable.
**P2**: cuentas por cobrar y presupuesto con invariantes numéricos y validación de documentos; gastos; proveedores; inventario con ledger y stock comprobable.
**P3**: formularios dinámicos seguros; motor de reportes visual Query Builder con uniones, filtros, agrupaciones, campos calculados y exportaciones; automatizaciones.

## 9. Primer mandato para Codex (copiar y pegar)
> Continúa BOBC CRM sobre el repositorio `jcarlospm05/Sistema-Artesanal-Android`, rama `main`, carpeta `docs/bobc-crm/`. Lee este datasheet y el código actual completo antes de escribir cambios. Es una WEB normal mobile-first (NO PWA), HTML/CSS/JavaScript ES6+ y IndexedDB, sin TypeScript. Respeta las 96 entidades y 115 referencias, las ocho áreas ampliadas y los datos existentes. **Primera tarea:** auditoría real del HEAD publicado y de la migración IndexedDB 1→2, especialmente el motor de backup v1/v2; crear pruebas reproducibles con navegador/IndexedDB y un `QA-REPORT.md` con resultados. Corrige defectos comprobados sin modificar BOBC Artesanía. Una vez aprobada la auditoría, implementa de manera modular CRUD completo y fichas vinculadas de Proyectos y Contratos. No simules botones terminados. Confirma cada commit y prueba la URL pública.

## 10. Referencias directas
- Código: https://github.com/jcarlospm05/Sistema-Artesanal-Android/tree/main/docs/bobc-crm
- Esquema original: https://github.com/jcarlospm05/Sistema-Artesanal-Android/blob/main/docs/bobc-crm/data/schema.json
- Esquema ampliado: https://github.com/jcarlospm05/Sistema-Artesanal-Android/blob/main/docs/bobc-crm/data/schema-extension-v2.json
- Migración: https://github.com/jcarlospm05/Sistema-Artesanal-Android/blob/main/docs/bobc-crm/js/core/idb.js
- UI modular: https://github.com/jcarlospm05/Sistema-Artesanal-Android/blob/main/docs/bobc-crm/js/modules/module-manager.js
- App web: https://jcarlospm05.github.io/Sistema-Artesanal-Android/bobc-crm/
