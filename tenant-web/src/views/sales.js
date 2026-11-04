import { el,btn,pageHeader,card,dataTable,errorState,pill,emptyState } from "../lib/ui.js";
import { getClient } from "../lib/supabase.js";
import { fmtMoney,fmtDateTime } from "../lib/format.js";

export function renderSales(container){
 const host=el("div",{}),summary=el("p",{class:"muted"});
 container.replaceChildren(pageHeader({title:"Ventas y pagos",subtitle:"Órdenes verificadas con Wompi y proyectos de aplicación propia.",actions:[btn({label:"Actualizar",icon:"refresh",onClick:load}),btn({label:"Ver página pública",href:"planes.html"})]}),summary,host);
 async function load(){
  summary.textContent="Consultando órdenes…";
  try{
   const {data,error}=await getClient().from("commerce_order_summary").select("id,reference,product_id,product_kind,amount_cents,environment,company_name,buyer_name,buyer_email,buyer_phone,tenant_id,status,fulfillment,created_at").order("created_at",{ascending:false}).limit(500);
   if(error)throw new Error("No se pudieron consultar las órdenes. Revisa la configuración comercial de Supabase.");
   const rows=data||[],paid=rows.filter(r=>r.environment==="prod"&&r.status==="APPROVED");
   summary.textContent=`${paid.length} compras reales aprobadas · ${fmtMoney(paid.reduce((sum,r)=>sum+r.amount_cents/100,0))} registrados en esta consulta. Los pagos de Sandbox se excluyen de estas cifras.`;
   const state={PENDING:"Pendiente",APPROVED:"Aprobado",DECLINED:"Rechazado",VOIDED:"Anulado",ERROR:"Error"};
   const fulfillment={pending:"Esperando pago",active:"Beneficios activados",pin_ready:"Empresa creada · PIN preparado",project_pending:"Coordinar entrega de aplicación propia",review_required:"Revisión de empresa requerida",test_only:"Prueba · sin activación real"};
   host.replaceChildren(card(dataTable({caption:"Órdenes comerciales",columns:[
    {label:"Empresa",render:r=>el("div",{class:"cell-stack"},[el("strong",{},r.company_name),el("span",{class:"muted small"},r.buyer_email),r.buyer_phone?el("span",{class:"muted small"},r.buyer_phone):null])},
    {label:"Producto",render:r=>el("div",{class:"cell-stack"},[el("strong",{},r.product_kind==="own_app"?"Aplicación propia":r.product_kind==="event_pack"?"Créditos de eventos":"Membresía"),el("span",{class:"muted small"},r.product_id)])},
    {label:"Total",render:r=>fmtMoney(r.amount_cents/100)},
    {label:"Pago",render:r=>el("div",{class:"cell-stack"},[pill(state[r.status]||r.status,r.status==="APPROVED"?"ok":r.status==="PENDING"?"warn":"danger"),r.environment==="test"?pill("Sandbox","warn"):null])},
    {label:"Entrega / acceso",render:r=>fulfillment[r.fulfillment]||r.fulfillment},
    {label:"Referencia",render:r=>el("div",{class:"cell-stack"},[el("code",{class:"small"},r.reference),el("span",{class:"muted small"},fmtDateTime(r.created_at))])},
   ],rows,empty:emptyState({icon:"report",title:"Todavía no hay órdenes",text:"Las compras iniciadas en la página pública aparecerán aquí."})}),{cls:"card-flush"}));
  }catch(e){summary.textContent="";host.replaceChildren(errorState({message:e.message,retry:load}));}
 }
 void load();
}
