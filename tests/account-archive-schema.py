"""Constraint/trigger checks on the isolated, synthetic schema-upgrade database."""
import sqlite3,sys
c=sqlite3.connect(sys.argv[1]);c.execute('PRAGMA foreign_keys=ON');checks=0
def eq(a,b):
 global checks
 checks+=1;assert a==b,(a,b)
def run(sql,params=()):return c.execute(sql,params)
def blocked(sql,params=()):
 global checks
 checks+=1
 try:
  run(sql,params)
 except sqlite3.DatabaseError:return
 raise AssertionError('Accepted invalid archive metadata: '+sql)
owner='zero-schema-owner';legacy='zero-schema-account';active='archive-active'
def date(id):return run('SELECT archived_on FROM account_archive_dates WHERE owner_id=? AND account_id=?',(owner,id)).fetchall()
def revision():return run('SELECT revision FROM profiles WHERE owner_id=?',(owner,)).fetchone()[0]
def archive(id,value):run('UPDATE accounts SET archived=? WHERE owner_id=? AND id=?',(value,owner,id))
def insert(id,day,who=owner):run('INSERT INTO account_archive_dates VALUES(?,?,?)',(who,id,day))
def guard(id):run('INSERT INTO workspace_guards(id,owner_id,expected_revision,client_epoch) VALUES(?,?,?,37)',(id,owner,revision()))
eq(date(legacy),[]);eq(date(active),[])
for id,day,who in [(active,'2026-01-01',owner),(legacy,'2026-01-01','another-owner'),('missing','2026-01-01',owner),(legacy,'2025-02-29',owner),(legacy,'2026-02-30',owner),(legacy,'2026-1-01',owner),(legacy,'2199-01-01',owner),(legacy,'1899-12-31',owner)]:blocked('INSERT INTO account_archive_dates VALUES(?,?,?)',(who,id,day))
before=revision();insert(legacy,'2024-02-29');eq(date(legacy),[('2024-02-29',)]);eq(revision(),before+1)
blocked('UPDATE account_archive_dates SET account_id=? WHERE account_id=?',(active,legacy));blocked('UPDATE account_archive_dates SET owner_id=? WHERE account_id=?',('another-owner',legacy));blocked('UPDATE account_archive_dates SET archived_on=? WHERE account_id=?',('2025-02-29',legacy));blocked('UPDATE account_archive_dates SET archived_on=? WHERE account_id=?',('2199-01-01',legacy))
before=revision();run("UPDATE account_archive_dates SET archived_on='2024-02-29' WHERE account_id=?",(legacy,));eq(revision(),before)
run("UPDATE account_archive_dates SET archived_on='2024-03-01' WHERE account_id=?",(legacy,));eq(revision(),before+1)
before=revision();run('DELETE FROM account_archive_dates WHERE account_id=?',(legacy,));eq(revision(),before+1);eq(date(legacy),[])
current=run("SELECT date('now')").fetchone()[0];archive(active,1);eq(date(active),[(current,)])
run("UPDATE account_archive_dates SET archived_on='2024-02-29' WHERE account_id=?",(active,));archive(active,1);eq(date(active),[('2024-02-29',)])
archive(active,0);eq(date(active),[]);archive(active,1);eq(date(active),[(current,)])
archive(active,0);before=revision();guard('archive-ordinary');archive(active,1);eq(revision(),before);run('UPDATE profiles SET revision=revision+1 WHERE owner_id=?',(owner,));run('DELETE FROM workspace_guards WHERE owner_id=?',(owner,));eq(revision(),before+1);eq(date(active),[(current,)])
archive(active,0);guard('category-restore:archive-test');archive(active,1);eq(date(active),[]);insert(active,'2024-02-29');eq(date(active),[('2024-02-29',)]);run('DELETE FROM workspace_guards WHERE owner_id=?',(owner,))
run("INSERT INTO accounts(id,owner_id,name,type,currency,opening_balance,opening_date,archived) VALUES('archive-import',?,'Imported disabled','checking','USD',500,'2020-01-01',1)",(owner,));eq(date('archive-import'),[])
insert('archive-import','2024-02-29');run("DELETE FROM accounts WHERE id='archive-import'");eq(date('archive-import'),[])
eq(run('SELECT opening_balance FROM accounts WHERE id=?',(active,)).fetchone()[0],12345);eq(run('PRAGMA foreign_key_check').fetchall(),[])
print(f'{checks} SQLite archive-calendar, owned archived parent, immutable identity, revision, transition, guarded import, reactivation and cascade checks passed.')
c.rollback();c.close()
