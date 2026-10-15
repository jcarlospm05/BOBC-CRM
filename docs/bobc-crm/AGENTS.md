# Instrucciones operativas para Codex — BOBC CRM

**Actualización de alcance (petición posterior del usuario):** BOBC CRM pasa a un repositorio independiente llamado BOBC-CRM y se autoriza un APK propio. Estas instrucciones siguen aplicándose al núcleo web; android/, scripts/ y .github/workflows/ se rigen por AGENTS.md de la raíz. El datasheet adjunto se conserva como referencia histórica del código fuente, no como prohibición de la petición posterior.

**Antes de editar:** leer `BOBC_CRM_DATASHEET_CODEX_v0.4.md`, el HEAD de la rama `main`, ambos archivos `data/schema*.json` y el estado del deployment.

## Límites
- Modificar sólo `docs/bobc-crm/` salvo autorización explícita.
- BOBC CRM es web móvil convencional, **no PWA**. HTML/CSS/JS ES6+; no TypeScript.
- No destruir registros ni cambiar `DB_NAME='bobc-crm'` sin autorización.
- Migraciones IndexedDB aditivas, versionadas y verificadas.
- Usar componentes pequeños y reutilizables; evitar romper navegación o Relaciones.

## Entrega obligatoria por commit
1. Resumen de requisitos y archivos afectados.
2. Pruebas de sintaxis, esquema/referencias, CRUD, persistencia, backups y regresión.
3. `QA-REPORT.md` con resultados ejecutados, fallos, límites y número de commit.
4. URL de GitHub Pages verificada y notas de riesgos restantes.
5. No atribuir pruebas manuales Android a una validación automática o viceversa.

**Primera prioridad:** validar/solucionar incompatibilidad potencial de backup entre 51 y 96 entidades; después Proyectos y Contratos completos.
