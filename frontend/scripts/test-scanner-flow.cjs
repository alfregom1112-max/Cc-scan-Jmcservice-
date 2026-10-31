const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const ts = require('typescript');
const root = path.join(__dirname, '..');
const compile = source => ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
function callback(file, variable, globals) {
  const source = ts.createSourceFile(file, fs.readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let found;
  function visit(node) {
    if (ts.isVariableDeclaration(node) && node.name.getText(source) === variable && ts.isCallExpression(node.initializer)) found = node.initializer.arguments[0];
    ts.forEachChild(node, visit);
  }
  visit(source); assert.ok(found, variable + ' callback exists in production source');
  const expression = ts.createPrinter().printNode(ts.EmitHint.Expression, found, source);
  return vm.runInNewContext(compile('(' + expression + ')'), { ...globals, Date, Promise, setTimeout, clearTimeout });
}
function moduleFrom(file, globals = {}) {
  const exports = {};
  vm.runInNewContext(compile(fs.readFileSync(file, 'utf8')), { exports, AbortController, Promise, Error, Date, setTimeout, clearTimeout, ...globals });
  return exports;
}
async function testLocalButton(file) {
  let restarted = 0, photographed = 0, remote = 0, decoded = 0, saved = 0;
  const busy = { current: false }; const loading = [];
  const fn = callback(file, 'captureAndDecodeBarcode', {
    hasCamera: () => true, cameraReadBusy: busy, scanBusyRef: { current: false }, scanGeneration: { current: 0 },
    AppState: { currentState: 'active' }, setBarcodeLoading: value => loading.push(value),
    localCameraRef: { current: { restart: () => restarted++, readPdf417: async () => { decoded++; return { raw: '1234567890' }; } } },
    extractCedulaFromCameraPayload: () => '1234567890',
    captureCameraBase64: async () => { photographed++; return 'image'; },
    readCameraBarcode: async () => { remote++; return { raw: '' }; }, handleScan: async raw => { assert.equal(raw, '1234567890'); saved++; return true; },
    showToast: () => {}, Haptics: { notificationAsync: async () => {}, NotificationFeedbackType: { Warning: 'warning' } },
  });
  await fn();
  assert.equal(decoded, 1, 'Leer ahora must decode a real native capture'); assert.equal(saved, 1);
  assert.equal(restarted, 0); assert.equal(busy.current, false); assert.deepEqual(loading, [true, false]);
  assert.equal(photographed, 0); assert.equal(remote, 0, 'Local reading must not call the disabled photo API');
}
async function testManualReadFailures(file) {
  for (const scenario of ['empty', 'unsupported', 'error', 'stale']) {
    const busy = { current: false }, generation = { current: 0 }; let saves = 0; const loading = [];
    const fn = callback(file, 'captureAndDecodeBarcode', {
      hasCamera: () => true, cameraReadBusy: busy, scanBusyRef: { current: false }, scanGeneration: generation,
      AppState: { currentState: 'active' }, setBarcodeLoading: value => loading.push(value),
      localCameraRef: { current: { readPdf417: async () => {
        if (scenario === 'error') throw new Error('Capture timed out');
        if (scenario === 'stale') generation.current++;
        return { raw: scenario === 'empty' ? '' : 'test payload' };
      } } }, extractCedulaFromCameraPayload: () => scenario === 'unsupported' ? '' : '1234567890',
      handleScan: async () => { saves++; return true; }, showToast: () => {}, errorMessage: error => error.message,
    });
    await fn();
    assert.equal(saves, 0, scenario + ': must not register a failed or stale photo');
    assert.equal(busy.current, false); assert.deepEqual(loading, [true, false]);
  }
}
async function main() {
  if (process.argv[2] === '--baseline') { await testLocalButton(process.argv[3]); return; }
  const deadline = moduleFrom(path.join(root, 'src/utils/scanDeadline.ts'), {
    setTimeout: (fn, ms) => setTimeout(fn, Math.min(ms, 20)),
  }).withScanDeadline;
  assert.equal(await deadline(async () => 'ready'), 'ready');
  let signal;
  let timeout;
  try { await deadline(s => { signal = s; return new Promise(() => {}); }); }
  catch (error) { timeout = error; }
  assert.equal(timeout?.status, 0, 'A stalled request must become a retryable network failure');
  assert.equal(signal.aborted, true, 'Abort the underlying request as well as releasing the UI');
  await assert.rejects(deadline(() => { throw new Error('sync failure'); }), /sync failure/);
  const denied = Object.assign(new Error('denied'), { status: 403 });
  await assert.rejects(deadline(() => Promise.reject(denied)), error => error === denied);

  let handler;
  const requests = [];
  const service = moduleFrom(path.join(root, 'src/services/supabaseApi.ts'), {
    require: name => {
      if (name.endsWith('/scanDeadline')) return { withScanDeadline: deadline };
      if (name.endsWith('/supabase')) return {
        requireSupabaseConfig() {},
        supabase: { rpc: (name, args) => ({ abortSignal: s => { requests.push({ name, args, signal: s }); return handler(name, args); } }) },
      };
      throw new Error('Unexpected import: ' + name);
    },
  });
  handler = () => new Promise(() => {});
  await assert.rejects(service.lookupPerson('event-A', '1234567890'), error => error.status === 0);
  const input = { evento_id: 'event-A', cedula: '1234567890', nombre: 'ANA PEREZ GOMEZ', device_id: 'test-device', timestamp: 1,
    idempotency_key: 'test-' + 'a'.repeat(32) };
  await assert.rejects(service.recordScan(input), error => error.status === 0);
  let calls = 0;
  handler = () => ++calls === 1
    ? Promise.resolve({ data: null, error: { message: 'function record_scan display_name does not exist' } })
    : Promise.resolve({ data: [{ scan_id: 'scan-1', duplicate: false, result: 'found' }], error: null });
  const saved = await service.recordScan(input);
  assert.equal(saved.ok, true); assert.equal(saved.registro.nombre, input.nombre);
  const last = requests.slice(-2);
  assert.equal(last[0].args.p_idempotency_key, last[1].args.p_idempotency_key, 'Compatibility retry must keep the same scan key');
  assert.equal(last[0].args.p_event_id, 'event-A');

  const queued = [];
  const noop = () => {};
  const scan = callback(path.join(root, 'src/ctx/evento.tsx'), 'scan', {
    eventoId: 'event-A', user: { id: 'operator-A' }, cedulasSetRef: { current: new Set() }, deviceIdRef: { current: 'test-device' },
    newNonce: () => 'a'.repeat(32), api: { escanear: async () => { throw timeout; } },
    shouldQueueAfterError: error => error.status === 0,
    enqueuePendingScan: async record => queued.push(record), listPendingScans: async () => queued,
    addRegistro: noop, setLastSuccess: noop, setQueueSize: noop, setLastDuplicate: noop, setDuplicadosBloqueados: noop,
  });
  const offline = await scan(input.cedula, { nombre: input.nombre });
  assert.equal(offline.ok, true); assert.equal(queued.length, 1);
  assert.equal(queued[0].evento_id, 'event-A'); assert.equal(queued[0].nombre, input.nombre);
  assert.ok(queued[0].idempotency_key.endsWith('a'.repeat(32)), 'Keep the pending record key for later sync');
  const busy = { current: false }, documentTimer = { current: null }, enabled = [];
  handler = () => new Promise(() => {});
  const handleScan = callback(path.join(root, 'app/(app)/escanear.tsx'), 'handleScan', {
    mode: 'camera', eventoId: 'event-A', scanBusyRef: busy, scanGeneration: { current: 0 }, AppState: { currentState: 'active' },
    setScannerEnabled: value => enabled.push(value), mrzIdentityCandidate: () => null, isMrzText: () => false,
    normalizeQrCedulaPayload: value => value, isReliableBarcode: () => true,
    parsePdf417: () => ({ cedula: input.cedula, nombres: input.nombre }), cleanCedulaNumber: value => value,
    extractCedula: () => input.cedula, lastScanRef: { current: null }, lookupSequence: { current: 0 },
    setPreview: noop, setPreviewLoading: noop, showToast: noop,
    api: { lookupAfiliado: () => service.lookupPerson('event-A', input.cedula) },
    normalizeAfiliadoData: () => ({ nombre: '', cargo: '', municipio: '' }), parsedFullName: () => input.nombre,
    scan, buildDocumentPreview: () => ({}), setDocumentPreview: noop, documentPreviewTimerRef: documentTimer,
    Haptics: { notificationAsync: async () => {}, NotificationFeedbackType: { Success: 'ok' } },
    rearmScanner: () => enabled.push(true),
  });
  assert.equal(await handleScan(input.cedula, { skipBarcodeFallback: true }), true);
  clearTimeout(documentTimer.current);
  assert.equal(busy.current, false, 'A stalled lookup must release the actual screen scan gate');
  assert.deepEqual(enabled, [false, true], 'The actual screen must pause then rearm after queuing');
  await testLocalButton(path.join(root, 'app/(app)/escanear.tsx'));
  await testManualReadFailures(path.join(root, 'app/(app)/escanear.tsx'));
  console.log('Scanner flow passed: local button, stalled lookup/save, abort, failure propagation, idempotency and durable queue handoff.');
}
main().catch(error => { console.error(error); process.exitCode = 1; });
