import sqlite3,sys
c=sqlite3.connect(sys.argv[1]);c.execute('PRAGMA foreign_keys=ON');owner='zero-schema-owner';checks=0
c.execute("INSERT INTO accounts(id,owner_id,name,type,currency,opening_balance,opening_date) VALUES('label-account',?,'Labels','investment','USD',100000,'2020-01-01')",(owner,))
c.execute("INSERT INTO securities(id,owner_id,ticker,name,exchange,kind) VALUES('label-security',?,'LBL','Labels','XNYS','standard')",(owner,))
def eq(a,b):
 global checks
 checks+=1;assert a==b,(a,b)
def blocked(s,p=()):
 global checks
 checks+=1
 try:c.execute(s,p)
 except sqlite3.DatabaseError as e:assert 'workspace_changed' in str(e),str(e);return
 raise AssertionError('Accepted old financial editor: '+s)
def guard(epoch):
 c.execute('DELETE FROM workspace_guards WHERE owner_id=?',(owner,));c.execute("INSERT INTO workspace_guards(id,owner_id,expected_revision,client_epoch) SELECT 'label-guard',owner_id,revision,? FROM profiles WHERE owner_id=?",(epoch,owner))
def clear():c.execute('DELETE FROM workspace_guards WHERE owner_id=?',(owner,))
insert="INSERT INTO trades(id,owner_id,account_id,security_id,date,name,qty,price,fee,cash_amount,currency,activity,sequence,notes) VALUES(?,?,'label-account','label-security','2026-01-02','Event','1','10',20,0,'USD',?,1,'')"
for activity in ['contribution','withdrawal','exchange','other']:
 guard(6);blocked(insert,(activity,owner,activity));clear();blocked(insert,(activity,owner,activity));guard(8);c.execute(insert,(activity,owner,activity));clear();eq(c.execute('SELECT cash_amount,activity FROM trades WHERE id=?',(activity,)).fetchone(),(0,activity))
 for epoch in [None,6]:
  if epoch is None:clear()
  else:guard(epoch)
  for field,value in [('qty','2'),('price','20'),('cash_amount',100),('fee',21),('activity','buy'),('currency','EUR'),('sequence',2),('date','2026-01-03'),('conversion','{}')]:blocked('UPDATE trades SET '+field+'=? WHERE id=?',(value,activity))
  blocked('DELETE FROM trades WHERE id=?',(activity,));clear()
 guard(6);c.execute("UPDATE trades SET name='Renamed',notes='Preserved' WHERE id=?",(activity,));clear();eq(c.execute('SELECT cash_amount,fee,activity FROM trades WHERE id=?',(activity,)).fetchone(),(0,20,activity))
 guard(8);c.execute('UPDATE trades SET cash_amount=100 WHERE id=?',(activity,));clear();eq(c.execute('SELECT cash_amount FROM trades WHERE id=?',(activity,)).fetchone()[0],100)
 guard(37);c.execute('DELETE FROM trades WHERE id=?',(activity,));c.execute(insert,(activity,owner,activity));clear();eq(c.execute('SELECT cash_amount FROM trades WHERE id=?',(activity,)).fetchone()[0],0)
# A guard for another owner is not permission to update this owner's new labels.
c.execute("INSERT INTO profiles(owner_id,name,currency,revision) VALUES('label-other','Other','USD',0)");c.execute("INSERT INTO workspace_guards(id,owner_id,expected_revision,client_epoch) VALUES('other-label-guard','label-other',0,8)");blocked("UPDATE trades SET cash_amount=50 WHERE id='exchange'");c.execute("DELETE FROM workspace_guards WHERE id='other-label-guard'")
# Old known activity rows retain old-editor compatibility; their transition to a new label is protected.
guard(6);c.execute(insert,('old-buy',owner,'buy'));c.execute("UPDATE trades SET cash_amount=-1200 WHERE id='old-buy'");blocked("UPDATE trades SET activity='exchange' WHERE id='old-buy'");c.execute("DELETE FROM trades WHERE id='old-buy'");clear();eq(c.execute('PRAGMA foreign_key_check').fetchall(),[])
c.rollback();c.close();print(f'PASS {checks} SQLite old-editor insert/update/delete, harmless metadata edit, current investment/recovery epoch, owner-bound guard and legacy activity compatibility checks.')
