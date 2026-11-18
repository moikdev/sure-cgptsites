import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
if(!existsSync('dist/server/wrangler.json')) throw new Error('Run npm run build before applying local migrations.');
const journal=JSON.parse(readFileSync('drizzle/meta/_journal.json','utf8'));
// Wrangler's migration tracker records each file and applies only new migrations.
const config=JSON.parse(readFileSync('dist/server/wrangler.json','utf8'));
const { mkdirSync, writeFileSync }=await import('node:fs');
mkdirSync('.sites-runtime',{recursive:true});
// Preserve binding configuration but resolve paths relative to this temporary config.
config.main='../dist/server/index.js';
config.assets={directory:'../dist/client'};
config.d1_databases=config.d1_databases.map(d=>({...d,migrations_dir:'../drizzle'}));
writeFileSync('.sites-runtime/local-migrations.json',JSON.stringify(config));
if(!journal.entries.length) throw new Error('No migrations found.');
const result=spawnSync(process.execPath,['--import','./scripts/sites-env.mjs','./node_modules/wrangler/bin/wrangler.js','d1','migrations','apply','DB','--local','--config','.sites-runtime/local-migrations.json','--persist-to','.wrangler/state'],{stdio:'inherit',env:{...process.env,CI:'1'}});
process.exit(result.status??1);
