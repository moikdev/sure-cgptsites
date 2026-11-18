import {RE2JS} from 're2js';

export const RULE_REGEX_DIALECT='re2-v1';
export const RULE_REGEX_LIMITS={characters:200,program:2048,expansion:20000,patterns:32,totalProgram:8192,runWork:50000000} as const;
export const IMPORTED_REGEX_REVIEW='Regular-expression syntax needs review: Sure uses PostgreSQL patterns; rebuild this condition using Sites RE2 syntax before enabling it.';
const cache=new Map<string,RE2JS>();

/** Bound counted-repeat expansion before asking the engine to compile it. */
function preflight(pattern:string){
 if(!pattern.trim())throw new Error('A regular expression must not be blank.');
 if([...pattern].length>RULE_REGEX_LIMITS.characters)throw new Error('A regular expression must have at most 200 characters.');
 if(pattern.includes('\0')||!pattern.isWellFormed())throw new Error('A regular expression must contain valid Unicode text without null characters.');
 // Deliberately conservative: even a quoted/literal counted repeat contributes
 // to this pre-compile bound. No escape or character-class dialect can bypass it.
 let expansion=1;
 for(const repeat of pattern.matchAll(/\{(\d+)(?:,(\d*))?\}/g)){
  const bound=Number(repeat[2]===undefined||repeat[2]===''?repeat[1]:repeat[2]);expansion*=Math.max(1,bound);
  if(!Number.isSafeInteger(expansion)||expansion*Math.max(1,pattern.length)>RULE_REGEX_LIMITS.expansion)throw new Error('This regular expression expands too far. Use smaller counted repeats.');
 }
 let quoted=false;
 for(let i=0;i<pattern.length;i++){
  const c=pattern[i];
  if(c==='\\'){
   const next=pattern[++i];
   if(quoted){if(next==='E')quoted=false;continue;}
   if(next==='Q'){quoted=true;continue;}
   if(next&&/[1-9]/.test(next))throw new Error('Backreferences are not supported in regular expressions.');
   continue;
  }
 }
}

export function compileRuleRegex(pattern:string){
 const prior=cache.get(pattern);if(prior){cache.delete(pattern);cache.set(pattern,prior);return prior;}
 preflight(pattern);let compiled:RE2JS;
 try{compiled=RE2JS.compile(pattern,RE2JS.CASE_INSENSITIVE|RE2JS.DOTALL);}
 catch{throw new Error('Invalid or unsupported RE2 regular expression. Check brackets, escapes and groups; lookarounds and backreferences are unavailable.');}
 if(compiled.programSize()>RULE_REGEX_LIMITS.program)throw new Error('This regular expression is too complex. Use fewer alternatives or smaller repeats.');
 cache.set(pattern,compiled);if(cache.size>RULE_REGEX_LIMITS.patterns)cache.delete(cache.keys().next().value!);return compiled;
}

export function validateRuleRegexSet(patterns:Iterable<string>){
 const distinct=new Set(patterns);if(distinct.size>RULE_REGEX_LIMITS.patterns)throw new Error('A workspace can use at most 32 distinct regular expressions.');
 let program=0;for(const pattern of distinct)program+=compileRuleRegex(pattern).programSize();
 if(program>RULE_REGEX_LIMITS.totalProgram)throw new Error('The workspace regular expressions are too complex together. Simplify their alternatives or repeats.');
}

export interface RuleRegexRun {work:number;}
export function matchesRuleRegex(pattern:string,input:string,run:RuleRegexRun={work:0}){
 const compiled=compileRuleRegex(pattern);run.work+=compiled.programSize()*Math.max(1,input.length);
 if(run.work>RULE_REGEX_LIMITS.runWork)throw new Error('This regular-expression rule run is too large. Narrow its account/date range or simplify the patterns.');
 // find() requests capture state and uses bounded matching machinery rather than
 // retaining a separate potentially 8 MiB DFA cache for every workspace pattern.
 return compiled.matcher(input).find();
}
