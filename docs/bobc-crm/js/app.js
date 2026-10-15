import {ModuleManager} from './modules/module-manager.js';
import {relationshipsCsv} from './core/csv.js';
const el=id=>document.getElementById(id);
const escape=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const toast=s=>{const n=el('notice');n.textContent=s;setTimeout(()=>{if(n.textContent===s)n.textContent=''},5000)};
async function start(){
 const status=el('status');
 try{
  const [{loadSchema},{openDatabase},{Repository},{PartyService},{exportBackup,restoreBackup,downloadBlob}]=await Promise.all([
    import('./core/schema.js'),import('./core/idb.js'),import('./core/repository.js'),
    import('./modules/relationships/party-service.js'),import('./core/backup.js')]);
  const schema=await loadSchema(),db=await openDatabase(schema),repo=new Repository(db,schema),parties=new PartyService(repo);
  let tab='relaciones';const mod=new ModuleManager(el('moduleRoot'),repo,schema,toast);
  status.textContent='Base local activa · '+Object.keys(schema).length+' entidades';
  const sections=Object.keys(schema);
  const counts=async()=>{const people=await repo.all('parties'),deals=await repo.all('opportunities'),activities=await repo.all('activity_items');return {people,deals,activities}};
  async function render(){
   const {people,deals,activities}=await counts();
   const q=el('search').value.toLocaleLowerCase();
   const rows=people.filter(p=>(p.display_name||'').toLocaleLowerCase().includes(q)).sort((a,b)=>(a.display_name||'').localeCompare(b.display_name||''));
   el('count').textContent=rows.length;
   el('records').innerHTML=rows.length?rows.map(p=>'<article class="record"><div><b>'+escape(p.display_name)+'</b><small>'+(p.party_type==='PERSON'?'Persona':'Empresa')+' · '+(p.lifecycle==='LEAD'?'Prospecto':p.lifecycle==='CUSTOMER'?'Cliente':'Archivado')+'</small></div>'+(p.lifecycle==='LEAD'?'<button class="mini" data-convert="'+escape(p.id)+'">Convertir</button>':'')+'</article>').join(''):'<div class="empty">No hay coincidencias. Pulsa + para registrar un prospecto o cliente.</div>';
   el('relPanel').hidden=tab!=='relaciones';el('placeholder').hidden=tab==='relaciones'||tab==='mas';if(tab==='mas'){el('moduleRoot').hidden=false;await mod.draw()}else{el('moduleRoot').hidden=true}
   el('new').hidden=tab!=='relaciones';
   el('placeholderTitle').textContent=({inicio:'Resumen de operaciones',comercial:'Negocios',reportes:'Reportes',mas:'Módulos y configuración'})[tab]||'';
   let html='';
   if(tab==='inicio')html='<div class="stats">'+
    [['Clientes',people.filter(x=>x.lifecycle==='CUSTOMER').length],['Prospectos',people.filter(x=>x.lifecycle==='LEAD').length],['Negocios',deals.length],['Actividades',activities.length]].map(([a,b])=>'<div class="record"><div><b>'+b+'</b><small>'+a+'</small></div></div>').join('')+'</div><p>Resumen calculado directamente desde los registros locales.</p><button class="mini" data-go="relaciones">Ver relaciones</button>';
   if(tab==='comercial')html='<p>Existen '+deals.length+' negocios registrados en la base.</p><div class="empty">El formulario de oportunidades y el tablero Kanban están en desarrollo. No se habilitan botones de creación hasta que estén operativos.</div><button class="mini" data-go="relaciones">Ver clientes</button>';
   if(tab==='reportes')html='<p>Reporte básico de datos del CRM.</p><div class="record"><div><b>'+people.length+' relaciones</b><small>'+people.filter(x=>x.lifecycle==='CUSTOMER').length+' clientes · '+people.filter(x=>x.lifecycle==='LEAD').length+' prospectos</small></div></div><div class="record"><div><b>'+deals.length+' oportunidades</b><small>'+activities.length+' actividades registradas</small></div></div><button class="mini" data-export="csv">Exportar relaciones CSV</button><p>El constructor avanzado de reportes está pendiente.</p>';
   el('placeholder').querySelector('.dynamic')?.remove();
   const div=document.createElement('div');div.className='dynamic';div.innerHTML=html;el('placeholder').appendChild(div);
   document.querySelectorAll('[data-tab]').forEach(b=>{b.classList.toggle('active',b.dataset.tab===tab);if(b.dataset.tab===tab)b.setAttribute('aria-current','page');else b.removeAttribute('aria-current')});
   el('new').setAttribute('aria-label',tab==='relaciones'?'Agregar relación':'');
  }
  async function backup(){try{let validation;const blob=await exportBackup(db,schema,result=>{validation=result});const result=await downloadBlob(blob,'BOBC-CRM-'+new Date().toISOString().slice(0,10)+'.json');if(result.cancelled){toast('Guardado del respaldo cancelado');return}const notice=result.saved?'Respaldo guardado':'Descarga del respaldo iniciada';toast(validation?.passed?notice:notice+' con advertencias de integridad. Conserva el archivo antes de corregir los datos.')}catch(e){toast('Error del respaldo: '+e.message)}}
  el('backup').onclick=backup;
  el('import').onclick=()=>el('file').click();
  el('file').onchange=async e=>{const f=e.target.files?.[0];if(!f)return;try{if(!confirm('La restauración reemplazará los registros locales. ¿Continuar?'))return;await restoreBackup(db,schema,await f.text());await render();toast('Datos restaurados')}catch(ex){toast('No se restauró: '+ex.message)}finally{e.target.value=''}};
  el('search').oninput=()=>render().catch(e=>toast(e.message));
  el('new').onclick=()=>el('dialog').showModal();
  el('cancel').onclick=()=>el('dialog').close();
  el('form').onsubmit=async e=>{e.preventDefault();try{await parties.create({display_name:el('personName').value.trim(),party_type:el('personType').value,lifecycle:el('personStage').value});el('dialog').close();el('form').reset();await render();toast('Registro guardado')}catch(ex){toast('Error: '+ex.message)}};
  el('records').onclick=async e=>{const btn=e.target.closest('[data-convert]');if(!btn)return;try{await parties.convertLead(btn.dataset.convert);await render();toast('Prospecto convertido a cliente')}catch(ex){toast(ex.message)}};
  document.querySelectorAll('[data-tab]').forEach(b=>b.onclick=()=>{tab=b.dataset.tab;render().catch(e=>toast(e.message))});
  el('placeholder').onclick=async e=>{const b=e.target.closest('button');if(!b)return;try{if(b.dataset.go){tab=b.dataset.go;await render()}if(b.dataset.export==='json')await backup();if(b.dataset.export==='csv'){const people=await repo.all('parties');const result=await downloadBlob(new Blob([relationshipsCsv(people)],{type:'text/csv;charset=utf-8'}),'BOBC-CRM-Relaciones.csv');toast(result.cancelled?'Guardado del CSV cancelado':result.saved?'CSV guardado':'Descarga del CSV iniciada')}}catch(error){toast('Error: '+error.message)}};
  await render();
 }catch(err){status.textContent='Error: '+err.message;console.error(err);toast('No se pudo iniciar: '+err.message)}
}
start();
