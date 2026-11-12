import { createHash } from 'node:crypto';

const resolvers = new Map([
  ['b4b2f4fb7a3605a4312d6316d22cf6819e3316601ee833600804edaf9d3e1762', 'function jt(t,e,n){'],
  ['2062657c5b17f479bca62a2409d57ec14169746742bc9b4d57465553dde7eb2f', 'function je(t,e,n){'],
]);

// Reproducible compatibility build for the audited AM artifacts.
// The new branch passes through the logical target for the existing matrix/viewer DOM.
export function patchAdjustableMedia(bundle) {
  const resolver = resolvers.get(createHash('sha256').update(bundle).digest('hex'));
  if (!resolver) throw new Error('Unsupported Adjustable Media artifact. Expected an audited 0.8.2 or 0.9.0 bundle.');
  const text = bundle.toString('utf8');
  if (text.split(resolver).length !== 2) throw new Error('Unexpected AM resolver signature');
  return text.replace(resolver, resolver + 'if(e.kind==="image"&&/^nas:\\/\\//i.test(e.target))return{url:e.target,file:null};');
}
