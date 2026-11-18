"""Synthetic-only cross-table fixture and logical fingerprints for schema 59 checks."""
import hashlib,json,re,sqlite3,sys
from pathlib import Path

def quote(value):return '"'+value.replace('"','""')+'"'
def official():
 c=sqlite3.connect(':memory:')
 for file in sorted(Path('drizzle').glob('*.sql')):
  if int(file.name[:4])<=58:c.executescript(file.read_text())
 return c

def schema(c):return {name:[row[1] for row in c.execute('PRAGMA table_info('+quote(name)+')')] for name, in c.execute("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT IN ('d1_migrations','_cf_METADATA') ORDER BY name")}

def fingerprint(c):
 tables=schema(c);rows={}
 for table,columns in tables.items():
  digest=hashlib.sha256();count=0
  for row in c.execute('SELECT '+','.join(map(quote,columns))+' FROM '+quote(table)+' ORDER BY '+','.join(map(quote,columns))):
   digest.update(json.dumps(row,ensure_ascii=True,separators=(',',':')).encode());digest.update(b'\n');count+=1
  rows[table]={'rows':count,'sha256':digest.hexdigest()}
 triggers=list(c.execute("SELECT name,sql FROM sqlite_master WHERE type='trigger' ORDER BY name"));indexes=list(c.execute("SELECT name,sql FROM sqlite_master WHERE type='index' AND sql IS NOT NULL ORDER BY name"))
 return {'tables':rows,'triggers':triggers,'indexes':indexes,'foreignKeyCheck':list(c.execute('PRAGMA foreign_key_check'))}

mode,target,output=sys.argv[1:4]
c=sqlite3.connect(target);c.execute('PRAGMA foreign_keys=ON')
if mode=='seed':
 proof_files=re.findall(r"'((?:outputs/)[^']+proof\.json)'",Path('tests/persistence.mjs').read_text());proof_files=proof_files[:proof_files.index('outputs/daily-price-proof.json')+1];owners=set()
 def visit(value):
  if isinstance(value,list):
   for item in value:visit(item)
  elif isinstance(value,dict):
   for key,item in value.items():
    if key in ('owner','ownerId') or key.endswith('Owner'):
     if isinstance(item,str):owners.add(item)
    elif isinstance(item,(list,dict)):visit(item)
 for file in proof_files:
  # Keep this historical fixture limited to workflows that existed at schema 58.
  if Path(file).exists():visit(json.loads(Path(file).read_text()))
 assert owners and len(owners)<1000
 source_path=next(p for p in Path('.wrangler/state/v3/d1').rglob('*.sqlite') if p.name!='metadata.sqlite');source=sqlite3.connect('file:'+str(source_path.resolve())+'?mode=ro',uri=True)
 expected=official();tables=schema(expected);assert len(tables)==58
 triggers=list(c.execute("SELECT name,sql FROM sqlite_master WHERE type='trigger' ORDER BY name"));assert len(triggers)==383
 c.execute('BEGIN');c.execute('PRAGMA defer_foreign_keys=ON')
 for name,_ in triggers:c.execute('DROP TRIGGER '+quote(name))
 owner_list=sorted(owners)
 for table,columns in tables.items():
  query='SELECT '+','.join(map(quote,columns))+' FROM '+quote(table)+' WHERE owner_id IN ('+','.join('?' for _ in owner_list)+')'
  cursor=source.execute(query,owner_list)
  while batch:=cursor.fetchmany(512):c.executemany('INSERT INTO '+quote(table)+'('+','.join(map(quote,columns))+') VALUES('+','.join('?' for _ in columns)+')',batch)
 for _,sql in triggers:c.execute(sql)
 c.commit();source.close();expected.close()
 assert not list(c.execute('PRAGMA foreign_key_check'))
 c.execute("INSERT INTO profiles(owner_id,name,currency) VALUES('zero-schema-owner','Zero migration controls','USD')")
 c.execute("INSERT INTO accounts(id,owner_id,name,type,currency,opening_balance,opening_date) VALUES('zero-schema-account','zero-schema-owner','Cash','checking','USD',10000,'2026-01-01')")
 c.execute("INSERT INTO transactions(id,owner_id,account_id,date,name,amount,kind) VALUES('zero-schema-parent','zero-schema-owner','zero-schema-account','2026-01-02','Before',-100,'standard')");c.commit()
result=fingerprint(c);Path(output).write_text(json.dumps(result,indent=2)+'\n');print(json.dumps({'tables':len(result['tables']),'populatedTables':sum(v['rows']>0 for v in result['tables'].values()),'rows':sum(v['rows'] for v in result['tables'].values()),'triggers':len(result['triggers']),'indexes':len(result['indexes']),'foreignKeyViolations':len(result['foreignKeyCheck'])}));c.close()
