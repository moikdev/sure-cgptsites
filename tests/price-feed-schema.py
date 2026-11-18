import sqlite3,sys,json
c=sqlite3.connect(sys.argv[1]);c.execute('PRAGMA foreign_keys=ON');n=0
owner='zero-schema-owner';base=['f','req','{}','price-feed/f/source.json','pending','2026-01-01']
def fail(sql,args=()):
 global n
 try:c.execute(sql,args)
 except sqlite3.IntegrityError:n+=1
 else:raise AssertionError('Invalid lifecycle accepted: '+sql)
def run(sql,args=()):
 global n
 c.execute(sql,args);n+=1
insert="INSERT INTO price_feed_imports(id,owner_id,request_id,options_json,storage_key,status,created_at) VALUES(?,? ,?,?,?,?,?)"
run(insert,[base[0],owner,*base[1:]])
fail(insert,['wrong-owner','absent','other','{}','other','pending','today'])
fail("UPDATE price_feed_imports SET status='complete' WHERE id='f'")
fail("UPDATE price_feed_imports SET options_json='[]' WHERE id='f'")
fail("UPDATE price_feed_imports SET request_id='changed' WHERE id='f'")
fail("UPDATE price_feed_imports SET status='ready' WHERE id='f'")
fail("UPDATE price_feed_imports SET source_bytes=12 WHERE id='f'")
run("UPDATE price_feed_imports SET status='ready',source_sha256=?,source_bytes=200 WHERE id='f'",['a'*64])
fail("UPDATE price_feed_imports SET source_bytes=201 WHERE id='f'")
fail("INSERT INTO workspace_guards(id,owner_id,expected_revision,client_epoch) SELECT 'price-feed:f',owner_id,revision,28 FROM profiles WHERE owner_id=?",[owner])
fail("INSERT INTO workspace_guards(id,owner_id,expected_revision,client_epoch) SELECT 'price-feed:absent',owner_id,revision,6 FROM profiles WHERE owner_id=?",[owner])
fail("UPDATE price_feed_imports SET status='complete',completed_at='today',commit_receipt=?,completion_json='{}' WHERE id='f'",['b'*64])
run("INSERT INTO workspace_guards(id,owner_id,expected_revision,client_epoch) SELECT 'price-feed:f',owner_id,revision,6 FROM profiles WHERE owner_id=?",[owner])
run("UPDATE price_feed_imports SET status='complete',completed_at='today',commit_receipt=?,completion_json='{}' WHERE id='f'",['b'*64])
run("DELETE FROM workspace_guards WHERE id='price-feed:f'")
fail("UPDATE price_feed_imports SET completed_at='tomorrow' WHERE id='f'")
fail("UPDATE price_feed_imports SET completion_json='{\"changed\":true}' WHERE id='f'")
fail("UPDATE price_feed_imports SET status='ready' WHERE id='f'")
run("UPDATE price_feed_imports SET status='deleting' WHERE id='f'")
fail("UPDATE price_feed_imports SET status='ready' WHERE id='f'")
run("DELETE FROM price_feed_imports WHERE id='f'")
for i in range(10):run(insert,[str(i),owner,'r'+str(i),'{}','key'+str(i),'pending','today'])
fail(insert,['eleven',owner,'r11','{}','key11','pending','today'])
assert not list(c.execute('PRAGMA foreign_key_check'));c.rollback();print(f'{n} SQLite source guards: owner FK, limit, sealed source, epoch-bound approval, immutable completion and lifecycle transitions.')
