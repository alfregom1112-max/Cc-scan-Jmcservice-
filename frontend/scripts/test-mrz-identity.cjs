const fs = require('node:fs');
const assert = require('node:assert/strict');
const ts = require('typescript');
require.extensions['.ts'] = (module, filename) => module._compile(ts.transpileModule(
  fs.readFileSync(filename,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}
).outputText,filename);
const {validateMrz,MrzConsensus}=require('../src/utils/mrzValidation.ts');
const {parseMrz,parsePdf417,extractCedula}=require('../src/utils/cedula.ts');
const {mrzIdentityCandidate,validateReviewedIdentity,sameIdentityName}=require('../src/utils/mrzIdentityReview.ts');
const check = s => String([...s].reduce((n,c,i)=>n+(c==='<'?0:/\d/.test(c)?+c:c.charCodeAt(0)-55)*[7,3,1][i%3],0)%10);
function synthetic(nuip='76543210',name='PEREZ<GOMEZ<<LILI<ANA') {
  const a='ICCOL1234567897<<<<<<<<<<<<<<<';
  const b='9001011F3012316COL'+nuip.padEnd(10,'<')+'<';
  return [a,b+check(a.slice(5)+b.slice(0,7)+b.slice(8,15)+b.slice(18,29)),name.padEnd(30,'<')].join('\n');
}
let checks=0;
for (let length=5;length<=10;length++) {
  const nuip='7654321098'.slice(0,length),raw=synthetic(nuip);
  assert.equal(validateMrz(raw).valid,true,'synthetic source must be valid');
  for(const parse of [parseMrz,parsePdf417]) {
    assert.equal(parse(raw).cedula,nuip,'ICCOL must use NUIP regardless of its length relative to serial');checks++;
    assert.equal(parse(raw).mrz_valido,true,'canonical parser must match the validator');checks++;
  }
  assert.equal(extractCedula(raw),nuip);checks++;
}
const original=synthetic();
const invalid=original.replace('76543210','76543211');
assert.equal(validateMrz(invalid).valid,false);
assert.equal(parseMrz(invalid).cedula,'','invalid MRZ cannot expose a guessed identity');checks++;
assert.equal(parsePdf417(invalid).cedula,'','invalid MRZ cannot fall through to barcode guesses');checks++;
assert.equal(extractCedula(invalid),null,'invalid MRZ cannot fall through to digit extraction');checks++;
for(const name of ['SILKFERNANDEZ<<ANA','DE<LA<CRUZ<PEREZ<<ANA']) {
  const raw=synthetic('76543210',name);
  const expected=name.split('<<');
  const parsed=parseMrz(raw);
  assert.equal(parsed.nombres,expected[1]);checks++;
  assert.equal([parsed.primer_apellido,parsed.segundo_apellido].filter(Boolean).join(' '),expected[0].replace(/</g,' '),'no heuristic may delete surname letters');checks++;
}
// A name typo is not covered by TD1 checksums, even across three equal frames.
const typo=original.replace('LILI','LILA');
assert.equal(validateMrz(typo).valid,true);checks++;
const consensus=new MrzConsensus();
consensus.observe(typo,1,1);consensus.observe(typo,2,2);
assert.equal(consensus.observe(typo,3,3).valid,true);checks++;
assert.equal(mrzIdentityCandidate(typo).requiresReview,true,'stable name typos still require physical review');checks++;
assert.equal(mrzIdentityCandidate(invalid),null);checks++;
assert.equal(mrzIdentityCandidate(original).cedula,'76543210');checks++;
assert.equal(validateReviewedIdentity({cedula:'76543210',nombre:'ANA DE LA CRUZ PEREZ'}).identity.nombre,'ANA DE LA CRUZ PEREZ');checks++;
for(const input of [
  {cedula:'12345678901',nombre:'ANA PEREZ'}, {cedula:'76O43210',nombre:'ANA PEREZ'},
  {cedula:'76543210',nombre:''}, {cedula:'76543210',nombre:'ANA123'},
  {cedula:'76543210',nombre:'...'},
]) { assert.equal(validateReviewedIdentity(input).valid,false);checks++; }
assert.equal(sameIdentityName('PÉREZ GOMEZ ANA','Ana Pérez Gómez'),true);checks++;
assert.equal(sameIdentityName('ANA PEREZ','LINA PEREZ'),false);checks++;
assert.equal(sameIdentityName('ANA ANA PEREZ','ANA PEREZ'),false);checks++;
console.log(`${checks} MRZ identity regression checks passed; name-checksum limitation reproduced.`);
