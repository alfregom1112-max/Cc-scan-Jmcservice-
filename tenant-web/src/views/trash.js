import {el,btn,pageHeader,card,dataTable,emptyState,errorState,confirmDialog,toast} from '../lib/ui.js';
import {repo} from '../lib/repo.js';
import {fmtDateTime} from '../lib/format.js';
export async function renderTrash(container) {
 const host=el('div');
 container.replaceChildren(pageHeader({title:'Papelera',subtitle:'Registros retirados de la operación. Conservan su historial y pueden restaurarse.',actions:[btn({label:'Actualizar',onClick:load})]}),el('p',{class:'muted'},'La restauración conserva el estado pausado, inactivo o suspendido. No repone cupos, renueva membresías ni borra pagos. La supresión definitiva de datos personales se gestiona por separado.'),host);
 async function restore(row) {
  if(!await confirmDialog({title:'Restaurar registro',message:`¿Restaurar ${row.label}? Después podrás revisar y reactivar su acceso desde su sección.`,confirmLabel:'Restaurar'})) return;
  try{await repo.trash.restore(row.entity_type,row.entity_id);toast('Registro restaurado','ok');await load();}catch(e){toast(e.message,'danger');}
 }
 async function load(){try{const rows=await repo.trash.list();host.replaceChildren(card(dataTable({caption:'Registros en papelera',columns:[{label:'Registro',render:r=>r.label},{label:'Tipo',render:r=>({events:'Evento',profiles:'Usuario',tenants:'Empresa'})[r.entity_type]},{label:'Retirado',render:r=>fmtDateTime(r.deleted_at)},{label:'Acciones',render:r=>btn({label:'Restaurar',onClick:()=>restore(r)})}],rows,empty:emptyState({icon:'trash',title:'Papelera vacía',text:'Aquí aparecerán los registros enviados a la papelera.'})})));}catch(e){host.replaceChildren(errorState({message:e.message,retry:load}));}}
 await load();
}
