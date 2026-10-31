const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const ts = require('typescript');
const pilot = path.resolve(__dirname, '..');
const pro = process.argv[2] || path.resolve(pilot, '../../CcScanSes/frontend');
const files = [
  'modules/cedula-scanner/expo-module.config.json',
  'modules/cedula-scanner/android/src/main/AndroidManifest.xml',
  ...['FrameLease', 'MrzLineLocator', 'ReadingQuality', 'ScanPerformance', 'UprightLuma']
    .map(name => `modules/cedula-scanner/android/src/main/java/expo/modules/cedulascanner/${name}.kt`),
  'src/utils/scannerSession.ts',
];
for (const file of files) assert.equal(fs.readFileSync(path.join(pilot, file), 'utf8'), fs.readFileSync(path.join(pro, file), 'utf8'), file + ': must match Pro exactly');
const viewFile = 'modules/cedula-scanner/android/src/main/java/expo/modules/cedulascanner/CedulaScannerView.kt';
const section = (text, start, end) => text.slice(text.indexOf(start), text.indexOf(end, text.indexOf(start)));
const proView = fs.readFileSync(path.join(pro, viewFile), 'utf8');
const pilotView = fs.readFileSync(path.join(pilot, viewFile), 'utf8');
for (const [start, end] of [['  private fun startCamera()', '  private fun closeResources()'], ['  private fun observe(', '  fun capture(']])
  assert.equal(section(pilotView, start, end), section(proView, start, end), 'Camera resolution and MRZ observation remain the Pro implementation');
function readerLogic(root) {
  const file = path.join(root, 'src/components/LocalCedulaCamera.tsx');
  const source = ts.createSourceFile(file, fs.readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const result = {};
  const print = node => ts.createPrinter().printNode(ts.EmitHint.Unspecified, node, source);
  function visit(node) {
    if (ts.isVariableDeclaration(node) && node.name.getText(source) === 'observe') result.observe = print(node.initializer);
    if (ts.isJsxAttribute(node) && ['onStatus','onBarcode','onError'].includes(node.name.getText(source))) result[node.name.getText(source)] = print(node.initializer);
    ts.forEachChild(node, visit);
  }
  visit(source); assert.equal(Object.keys(result).length, 4);
  return result;
}
assert.deepEqual(readerLogic(pilot), readerLogic(pro), 'MRZ observations, status, barcode and error handlers must match Pro');
console.log(`${files.length} shared reader/configuration files match Pro; camera resolution, MRZ observation and all four JS event handlers match Pro. PDF417 extensions tested separately.`);
