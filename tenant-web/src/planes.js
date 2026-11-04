import { config } from "./lib/config.js";
import { getClient } from "./lib/supabase.js";

const money = n => new Intl.NumberFormat("es-CO", { style: "currency", currency: "COP", maximumFractionDigits: 0 }).format(n);
const byId = id => document.getElementById(id);
const grid = byId("public-plan-grid");
const whatsappNumber = "5732190078052";
let period = "event", chosen = null, catalog = null;
const fallback = { plans: [
 { id:"monthly_1_3",billing_period:"monthly",operators_limit:3,included_events:3,price_cop:1200000 },
 { id:"monthly_4_6",billing_period:"monthly",operators_limit:6,included_events:6,price_cop:2800000 },
 { id:"monthly_7_10",billing_period:"monthly",operators_limit:10,included_events:10,price_cop:4500000 },
 { id:"annual_1_3",billing_period:"annual",operators_limit:3,included_events:36,price_cop:12000000 },
 { id:"annual_4_6",billing_period:"annual",operators_limit:6,included_events:72,price_cop:28000000 },
 { id:"annual_7_10",billing_period:"annual",operators_limit:10,included_events:120,price_cop:45000000 },
 ],event_tiers:[{id:"operators_1_3",operators_min:1,operators_max:3,single_event_price_cop:450000,three_event_price_cop:1200000},{id:"operators_4_6",operators_min:4,operators_max:6,single_event_price_cop:null,three_event_price_cop:null},{id:"operators_7_10",operators_min:7,operators_max:10,single_event_price_cop:null,three_event_price_cop:null}], own_app:{id:"own_app",price_cop:9700000},checkout_ready:false };
const node=(tag,cls,text)=>{const el=document.createElement(tag);if(cls)el.className=cls;if(text!=null)el.textContent=text;return el;};
async function commerce(action, values={}) {
 // El gateway de Edge Functions exige Authorization incluso para el catálogo
 // público. La llave publicable no concede privilegios de servicio.
 const headers={"Content-Type":"application/json",apikey:config.supabasePublishableKey,Authorization:`Bearer ${config.supabasePublishableKey}`};
 const {data}=await getClient().auth.getSession();
 if(data.session?.access_token)headers.Authorization=`Bearer ${data.session.access_token}`;
 const res=await fetch(`${config.supabaseUrl}/functions/v1/public-commerce`,{method:"POST",headers,body:JSON.stringify({action,...values}),signal:AbortSignal.timeout(20000)});
 const result=await res.json();
 if(!res.ok||result.error)throw new Error(result.error||"No se pudo consultar el servicio comercial.");
 return result;
}
function choose(product) {
 chosen=product;
 window.dispatchEvent(new CustomEvent("jm:plan-selected",{detail:product}));
 const text=`Hola, JM ServiceTec. Quiero consultar esta opción: ${product.label}. Valor publicado: ${money(product.price)} COP. Por favor confirmen el precio final, disponibilidad y cómo continuar.`;
 window.location.assign(`https://wa.me/${whatsappNumber}?text=${encodeURIComponent(text)}`);
}
function quote(label){const text=`Hola, JM ServiceTec. Quiero solicitar una propuesta para ${label}. Por favor indíquenme los pasos para continuar.`;window.location.assign(`https://wa.me/${whatsappNumber}?text=${encodeURIComponent(text)}`);}
function paint(){
 grid.replaceChildren();
 const c=catalog||fallback;
 const entries=period==="event"?c.event_tiers:c.plans.filter(p=>p.billing_period===period);
 entries.forEach((p,i)=>{
  const event=period==="event";
  const card=node("article",`public-plan-card${i===1?" featured":""}`);
  const range=event?`${p.operators_min}–${p.operators_max}`:p.operators_limit===3?"1–3":p.operators_limit===6?"4–6":"7–10";
  card.append(node("span","plan-tag",event?"Jornadas a tu medida":period==="annual"?"Membresía anual":"Membresía mensual"),node("h3","",`${range} operadores`));
  const amount=event?p.single_event_price_cop:p.price_cop;
  const price=node("div",amount?"plan-price":"plan-price plan-quote-price",amount?money(amount):"A convenir");
  price.append(node("small","",amount?event?"COP · por evento":period==="annual"?"COP · por año":"COP · por mes":"Solicita una propuesta para este rango"));
  const features=node("ul");
  const details=[event?"1 jornada por cada crédito":`${p.included_events} eventos por ${period==="annual"?"año":"mes"}`,`Hasta ${event?p.operators_max:p.operators_limit} operadores por evento`,"Lectura local PDF417, OCR y MRZ","Administración, historial y reportes"];
  details.forEach(t=>features.append(node("li","",t)));
  card.append(price,features);
  const select=node("button",i===1?"btn btn-primary":"btn btn-secondary",amount?event?"Elegir 1 evento":"Elegir este plan":"Solicitar propuesta");select.type="button";
  select.addEventListener("click",()=>amount?choose({id:event?`event:${p.id}:1`:p.id,label:event?`1 evento · ${range} operadores`:`Plan ${period==="annual"?"anual":"mensual"} · ${range} operadores`,price:amount,description:event?"Se asigna un crédito de jornada tras aprobarse el pago.":`${p.included_events} eventos incluidos y hasta ${p.operators_limit} operadores por evento.`}):quote(`${range} operadores por evento`));
  card.append(select);
  if(event&&p.three_event_price_cop){const pack=node("button","btn btn-ghost",`3 eventos · ${money(p.three_event_price_cop)}`);pack.type="button";pack.addEventListener("click",()=>choose({id:`event:${p.id}:3`,label:`Paquete de 3 eventos · ${range} operadores`,price:p.three_event_price_cop,description:"Incluye tres créditos de jornada del rango seleccionado."}));card.append(pack);}
  grid.append(card);
 });
}
document.querySelectorAll("[data-period]").forEach(button=>button.addEventListener("click",()=>{period=button.dataset.period;document.querySelectorAll("[data-period]").forEach(b=>b.setAttribute("aria-pressed",String(b===button)));paint();}));
byId("choose-own-app").addEventListener("click",()=>choose({id:"own_app",label:"Aplicación propia para tu empresa",price:9700000,description:"Pago único del proyecto independiente. La entrega y el alcance se gestionan mediante acuerdo comercial."}));
paint();
commerce("catalog").then(data=>{catalog=data;paint();byId("catalog-notice").textContent="Catálogo actualizado. Selecciona una opción para consultar por WhatsApp.";}).catch(()=>{byId("catalog-notice").textContent="No se pudo actualizar el catálogo. Los precios mostrados son de referencia; confirma el valor con JM ServiceTec por WhatsApp.";});
