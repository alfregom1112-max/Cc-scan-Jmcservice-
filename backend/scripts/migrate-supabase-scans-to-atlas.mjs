import { createClient } from "@supabase/supabase-js";
import { MongoClient } from "mongodb";
import { randomUUID } from "node:crypto";
import { digestDocument, encryptField } from "../src/scanCrypto.js";

const required = ["SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY", "MONGODB_URI", "MONGODB_DB_NAME", "SCAN_DATA_ENCRYPTION_KEY", "SCAN_LOOKUP_HMAC_KEY"];
const missing = required.filter((key) => !process.env[key]);
if (missing.length) throw new Error(`Faltan variables: ${missing.join(", ")}`);
const apply = process.argv.includes("--apply");
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { autoRefreshToken: false, persistSession: false } });
const mongo = new MongoClient(process.env.MONGODB_URI, { appName: "jm-servicetec-scan-backfill", maxPoolSize: 5 });
await mongo.connect();
const scans = mongo.db(process.env.MONGODB_DB_NAME).collection("scans");
if (apply) await Promise.all([
  scans.createIndex({ tenant_id: 1, event_id: 1, idempotency_key: 1 }, { unique: true, name: "tenant_event_idempotency_uq" }),
  scans.createIndex({ tenant_id: 1, event_id: 1, document_type: 1, document_lookup: 1 }, { unique: true, name: "tenant_event_document_uq" }),
  scans.createIndex({ tenant_id: 1, legacy_source_id: 1 }, { unique: true, partialFilterExpression: { legacy_source_id: { $exists: true } }, name: "tenant_legacy_scan_uq" }),
]);

let offset = 0, read = 0, inserted = 0, alreadyPresent = 0, noTenant = 0;
const pageSize = 500;
try {
  while (true) {
    const { data, error } = await supabase.from("scans")
      .select("id,tenant_id,event_id,document_type,document_number,display_name,result,captured_at,received_at,device_id,operator_id,idempotency_key")
      .order("id", { ascending: true }).range(offset, offset + pageSize - 1);
    if (error) throw new Error(`No se pudo leer Supabase en la fila ${offset}: ${error.message}`);
    if (!data?.length) break;
    for (const row of data) {
      read++;
      if (!row.tenant_id) { noTenant++; continue; }
      const docType = String(row.document_type || "CC").trim().toUpperCase();
      const number = String(row.document_number || "").replace(/[\s.-]/g, "").toUpperCase();
      if (!number || !row.event_id || !row.idempotency_key) { alreadyPresent++; continue; }
      const scope = { tenant_id: row.tenant_id, event_id: row.event_id };
      const documentLookup = digestDocument(row.tenant_id, row.event_id, docType, number);
      const exists = await scans.findOne({ ...scope, $or: [
        { legacy_source_id: String(row.id) },
        { idempotency_key: String(row.idempotency_key).toLowerCase() },
        { document_type: docType, document_lookup: documentLookup },
      ] }, { projection: { _id: 1 } });
      if (exists) { alreadyPresent++; continue; }
      const record = {
        id: String(row.id || randomUUID()), legacy_source: "supabase", legacy_source_id: String(row.id), ...scope,
        document_type: docType, document_lookup: documentLookup,
        document_number_enc: encryptField(number), display_name_enc: encryptField(String(row.display_name || "")),
        result: row.result === "found" ? "found" : "not_found",
        captured_at: new Date(row.captured_at), received_at: new Date(row.received_at),
        device_id: String(row.device_id || ""), operator_id: String(row.operator_id),
        idempotency_key: String(row.idempotency_key).toLowerCase(),
      };
      if (!apply) { inserted++; continue; }
      try { await scans.insertOne(record); inserted++; }
      catch (error) { if (error?.code === 11000) alreadyPresent++; else throw error; }
    }
    offset += data.length;
    if (data.length < pageSize) break;
  }
  console.log(JSON.stringify({ mode: apply ? "APPLY" : "DRY_RUN", read, inserted_or_would_insert: inserted, already_present: alreadyPresent, missing_tenant: noTenant }, null, 2));
  if (!apply) console.log("No se cambió la base. Revisa y ejecuta de nuevo con --apply para importar.");
  if (noTenant) process.exitCode = 2;
} finally {
  await mongo.close();
}
