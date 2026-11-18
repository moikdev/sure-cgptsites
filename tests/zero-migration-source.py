"""Reproduce/check migration 59 from immutable schema-58 SQL, never from user data."""
import pathlib,sqlite3,sys
root=pathlib.Path(__file__).resolve().parent.parent
c=sqlite3.connect(':memory:')
for file in sorted((root/'drizzle').glob('*.sql')):
 if int(file.name[:4])<=58:c.executescript(file.read_text())
q=lambda value:'"'+value.replace('"','""')+'"'
tables=[r[0] for r in c.execute("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name")]
affected={'transactions','split_lines'}
while True:
 old=affected.copy()
 for table in tables:
  if any(row[2] in affected and row[6].upper() in ('CASCADE','SET NULL','SET DEFAULT') for row in c.execute('PRAGMA foreign_key_list('+q(table)+')')):affected.add(table)
 if old==affected:break
assert len(tables)==58 and len(affected)==7
triggers=[(name,sql) for name,sql,table in c.execute("SELECT name,sql,tbl_name FROM sqlite_master WHERE type='trigger' ORDER BY name") if table in affected]
assert len(triggers)==59
columns={t:[r[1] for r in c.execute('PRAGMA table_info('+q(t)+')')] for t in affected}
statements=['-- Widen two amount CHECK constraints without changing existing financial records.\n-- D1 keeps ON DELETE CASCADE active even with deferred foreign-key checks.\n-- Preserve the seven affected tables; leave all other table rows and callbacks untouched.\nPRAGMA defer_foreign_keys=ON;']
for table in sorted(affected):statements.append('CREATE TABLE '+q('__sure59_'+table)+' AS SELECT '+','.join(map(q,columns[table]))+' FROM '+q(table)+';')
for name,_ in triggers:statements.append('DROP TRIGGER '+q(name)+';')
# Re-create each target immediately. Leaving split_lines missing during DROP transactions
# makes SQLite's dependent foreign-key programs fail before deferred checking can apply.
for table in ('transactions','split_lines'):
 statements.append('DROP TABLE '+q(table)+';')
 sql=c.execute("SELECT sql FROM sqlite_master WHERE type='table' AND name=?",(table,)).fetchone()[0]
 old='"'+table+'"."amount" != 0 AND ';assert old in sql;statements.append(sql.replace(old,'')+';')
 for sql, in c.execute("SELECT sql FROM sqlite_master WHERE type='index' AND tbl_name=? AND sql IS NOT NULL ORDER BY name",(table,)):statements.append(sql+';')
for table in ['transactions','split_lines']+sorted(affected-{'transactions','split_lines'}):statements.append('INSERT INTO '+q(table)+'('+','.join(map(q,columns[table]))+') SELECT '+','.join(map(q,columns[table]))+' FROM '+q('__sure59_'+table)+';')
for table in sorted(affected):statements.append('DROP TABLE '+q('__sure59_'+table)+';')
for _,sql in triggers:statements.append(sql+';')
# Deferred constraints stay enabled until the migration transaction commits.
# Turning the pragma OFF here can suppress unresolved constraint checks in SQLite.
result='\n--> statement-breakpoint\n'.join(statements)+'\n'
assert len(result.encode())<100000
path=root/'drizzle/0059_zero_value_entries.sql'
if '--write' in sys.argv:path.write_text(result)
else:assert path.read_text()==result,'Migration 59 differs from its authoritative schema-58 derivation'
print({'tablesPreservedDirectly':len(tables)-len(affected),'cascadeTablesPreserved':len(affected),'callbacksTemporarilySuspended':len(triggers),'statements':len(statements),'bytes':len(result.encode())})
