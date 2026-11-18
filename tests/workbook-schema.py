import sqlite3,json,sys,copy
c=sqlite3.connect(sys.argv[1]);c.execute('PRAGMA foreign_keys=ON');checks=0;owner='workbook-guard-owner';now='2026-01-01T00:00:00.000Z';sha='f'*64;csvsha='a'*64
c.execute('INSERT INTO profiles(owner_id,name,currency,revision) VALUES(?,?,?,0)',(owner,'Synthetic workbook guard','USD'));c.execute("INSERT INTO accounts(id,owner_id,name,type,currency,opening_balance,opening_date) VALUES('workbook-guard-account',?,'Cash','checking','USD',0,'2026-01-01')",(owner,))
def file(id,who=owner,kind='application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',status='ready',digest=sha):c.execute('INSERT INTO statement_files(id,owner_id,filename,content_type,byte_size,sha256,upload_status,created_at,updated_at,storage_key) VALUES(?,?,?,?,1,?,?,?,?,?)',(id,who,id+'.xlsx',kind,digest,status,now,now,'synthetic/'+id))
file('guard-book');p=dict(file=dict(id='guard-book',filename='guard-book.xlsx',sha256=sha,byteSize=1),csvSHA256=csvsha,csvByteSize=1,extraction=dict(parser='sure-xlsx-v1',options=dict(sheetId='rId1'),sheet=dict(id='rId1'),rows=1,sourceRows=[2]))
def eq(a,b):
 global checks
 checks+=1;assert a==b,(a,b)
def insert(id,value):c.execute("INSERT INTO csv_imports(id,owner_id,account_id,request_id,filename,byte_size,sha256,options_json,storage_key,status,created_at,workbook_source_json) VALUES(?,?,'workbook-guard-account',?,'guard.csv',1,?,'{}',?,'uploading',?,?)",(id,owner,id,csvsha,'synthetic/'+id,now,value))
def reject(sql,args=(),message='workbook_source'):
 global checks
 checks+=1
 try:c.execute(sql,args)
 except sqlite3.DatabaseError as e:assert message in str(e),str(e)
 else:raise AssertionError('Accepted invalid workbook provenance')
insert('legacy-null',None);eq(c.execute("SELECT workbook_source_json FROM csv_imports WHERE id='legacy-null'").fetchone()[0],None);insert('valid',json.dumps(p));eq(c.execute("SELECT workbook_source_json FROM csv_imports WHERE id='valid'").fetchone()[0],json.dumps(p));c.execute("UPDATE csv_imports SET filename=filename WHERE id='valid'");eq(c.execute("SELECT workbook_source_json FROM csv_imports WHERE id='valid'").fetchone()[0],json.dumps(p))
for assignment in ["workbook_source_json=NULL","workbook_source_json='{}'","sha256='"+'b'*64+"'","byte_size=2","owner_id='different-owner'"]:reject("UPDATE csv_imports SET "+assignment+" WHERE id='valid'",message='workbook_source_immutable')
for i,invalid in enumerate(['{','{}','null','[]',json.dumps({**p,'csvSHA256':'b'*64}),json.dumps({**p,'csvByteSize':2})]):
 checks+=1
 try:insert('bad-'+str(i),invalid)
 except sqlite3.DatabaseError as e:assert 'workbook_source_invalid' in str(e)
 else:raise AssertionError('Invalid metadata accepted')
for i,patch in enumerate([dict(parser='wrong'),dict(rows=2),dict(sourceRows=[]),dict(options=dict(sheetId='other')),dict(sheet=dict(id='other'))]):
 q=copy.deepcopy(p);q['extraction'].update(patch);checks+=1
 try:insert('bad-shape-'+str(i),json.dumps(q))
 except sqlite3.DatabaseError as e:assert 'workbook_source_invalid' in str(e)
 else:raise AssertionError('Invalid extraction shape accepted')
c.execute("INSERT INTO profiles(owner_id,name,currency,revision) VALUES('workbook-other-owner','Other','USD',0)");file('foreign-book',who='workbook-other-owner');q=copy.deepcopy(p);q['file'].update(id='foreign-book',filename='foreign-book.xlsx');checks+=1
try:insert('bad-owner',json.dumps(q))
except sqlite3.DatabaseError as e:assert 'workbook_source_invalid' in str(e)
else:raise AssertionError('Cross-owner source accepted')
file('missing-book',status='missing',digest='e'*64);q=copy.deepcopy(p);q['file'].update(id='missing-book',filename='missing-book.xlsx',sha256='e'*64);checks+=1
try:insert('bad-missing',json.dumps(q))
except sqlite3.DatabaseError as e:assert 'workbook_source_invalid' in str(e)
else:raise AssertionError('Unavailable original accepted')
# Source history intentionally outlives its original, without a dangling foreign key.
c.execute("DELETE FROM statement_files WHERE id='guard-book'");eq(c.execute("SELECT workbook_source_json FROM csv_imports WHERE id='valid'").fetchone()[0],json.dumps(p));eq(c.execute('PRAGMA foreign_key_check').fetchall(),[]);c.rollback();c.close();print(f'PASS {checks} SQLite nullable legacy source, verified shape/checksum/size/owner/availability checks, immutable source and fingerprint, harmless metadata compatibility and retained evidence after original deletion.')
