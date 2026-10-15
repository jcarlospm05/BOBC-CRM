const AREAS={
'Proyectos':['projects','project_phases','project_tasks','project_milestones','project_deliverables'],
'Contratos':['contracts','contract_parties','contract_terms','contract_revisions','contract_renewals'],
'Cuentas por cobrar':['receivables','receivable_installments','receivable_payments','payment_allocations','collection_followups'],
'Gastos':['expense_categories','expenses','expense_items','expense_attachments'],
'Formularios':['form_submissions','form_answers','form_rules'],
'Presupuestos':['budgets','budget_lines','budget_versions','budget_actuals'],
'Inventario':['warehouses','inventory_items','inventory_lots','inventory_movements','stock_counts','stock_count_lines'],
'Proveedores':['suppliers','purchase_orders','purchase_order_lines','supplier_contacts','supplier_prices']
};
const LABEL={projects:'Proyectos',contracts:'Contratos',receivables:'Cuentas',expenses:'Gastos',budgets:'Presupuestos',warehouses:'Almacenes',inventory_items:'Artículos',inventory_movements:'Movimientos',suppliers:'Proveedores',purchase_orders:'Órdenes de compra'};
const safe=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const title=s=>LABEL[s]||s.replaceAll('_',' ').replace(/^./,c=>c.toUpperCase());
export function parseFieldValue(type, input) {
 const kind = type.replace(/\?$/, '');
 if (kind === 'boolean') return input.type === 'checkbox' ? input.checked :
  input.value === '' ? undefined : input.value === 'true';
 const value = input.value.trim();
 if (value === '') return undefined;
 if (kind === 'integer') {
  const number = Number(value);
  if (!Number.isSafeInteger(number)) throw new Error('Escribe un entero dentro del rango seguro');
  return number;
 }
 return value;
}

export class ModuleManager {
 constructor(root, repo, schema, notify) {
  this.root=root;this.repo=repo;this.schema=schema;this.notify=notify;
  this.area='Proyectos';this.entity='projects';this.drawVersion=0;
 }
 async open(){this.root.hidden=false;await this.draw()}
 async draw(){
  const version=++this.drawVersion,area=this.area,entity=this.entity;
  const active=()=>version===this.drawVersion;
  const areaNames=Object.keys(AREAS);
  this.root.innerHTML='<h2>Módulos v0.4</h2><p>Altas y consultas de registros vinculados. Los cálculos financieros automáticos aún están en desarrollo.</p>'+
   '<label>Área<select id="crm-area">'+areaNames.map(a=>'<option '+(a===area?'selected':'')+'>'+safe(a)+'</option>').join('')+'</select></label>'+
   '<label>Entidad<select id="crm-entity">'+AREAS[area].map(e=>'<option value="'+safe(e)+'" '+(e===entity?'selected':'')+'>'+safe(title(e))+'</option>').join('')+'</select></label>'+
   '<div id="crm-module-rows"></div><form id="crm-module-form"><h3>Nuevo registro: '+safe(title(entity))+'</h3><div id="crm-fields"></div><button type="submit" disabled>Guardar registro</button></form>';
  const form=this.root.querySelector('#crm-module-form'),fields=this.root.querySelector('#crm-fields');
  const rowsRoot=this.root.querySelector('#crm-module-rows'),submit=form.querySelector('[type="submit"]');
  const change=async action=>{try{action();await this.draw()}catch(error){this.notify('No se pudo cargar: '+error.message)}};
  this.root.querySelector('#crm-area').onchange=e=>change(()=>{this.area=e.target.value;this.entity=AREAS[this.area][0]});
  this.root.querySelector('#crm-entity').onchange=e=>change(()=>{this.entity=e.target.value});
  const spec=this.schema[entity];
  for(const [key,type] of Object.entries(spec.fields)){
   if(['id','created_at','updated_at'].includes(key))continue;
   const label=document.createElement('label');label.textContent=title(key);label.style.display='block';label.style.margin='12px 0';
   let input;
   if(spec.references?.[key]){
    input=document.createElement('select');input.name=key;input.appendChild(new Option('Sin vincular',''));
    const target=spec.references[key].split('.')[0],records=await this.repo.all(target);
    if(!active())return;
    for(const r of records){
     const name=r.display_name||r.name||r.title||r.contract_number||r.order_number||r.supplier_code||r.sku||String(r.id).slice(0,8);
     input.appendChild(new Option(String(name),r.id));
    }
   }else if(type.startsWith('boolean')){
    input=document.createElement('select');input.name=key;
    input.append(new Option('Sin definir',''),new Option('Sí','true'),new Option('No','false'));
   }else{
    input=document.createElement('input');input.name=key;
    input.type=type.replace(/\?$/, '')==='integer'?'number':'text';
    if(input.type==='number')input.step='1';
    if(key.endsWith('_date')||key.endsWith('_at'))input.placeholder='AAAA-MM-DD o fecha ISO';
   }
   input.className='crm-field';input.style.cssText='width:100%;padding:12px;border:1px solid #cad5d7;border-radius:10px;margin-top:5px';
   label.appendChild(input);fields.appendChild(label);
  }
  const rows=await this.repo.all(entity);
  if(!active())return;
  rowsRoot.innerHTML='<div class="record"><div><b>'+rows.length+' registros</b><small>'+safe(title(entity))+'</small></div></div>'+
   rows.slice().reverse().slice(0,30).map(r=>'<div class="record"><div><b>'+safe(r.name||r.title||r.contract_number||r.order_number||r.sku||r.supplier_code||r.description||String(r.id).slice(0,8))+'</b><small>'+safe(r.status||r.created_at?.slice(0,10)||'')+'</small></div></div>').join('');
  submit.disabled=false;
  form.onsubmit=async e=>{
   e.preventDefault();if(submit.disabled)return;
   const record={};
   try{
    for(const input of form.querySelectorAll('[name]')){
     const value=parseFieldValue(spec.fields[input.name],input);
     if(value!==undefined)record[input.name]=value;
    }
    if(!Object.keys(record).length){this.notify('Completa algún campo');return}
    submit.disabled=true;
    await this.repo.save(entity,record);
    this.notify('Registro guardado en '+title(entity));
    if(active())await this.draw();
   }catch(error){this.notify('No se guardó: '+error.message)}
   finally{if(active())submit.disabled=false}
  };
 }
 close(){this.drawVersion++;this.root.hidden=true}
}
export const MODULE_AREAS=AREAS;
