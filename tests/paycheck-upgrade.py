"""Additive declaration/cash controls with preserved rows, old-restore protection and manual locks."""
import pathlib,sqlite3

db=sqlite3.connect(':memory:');db.execute('PRAGMA foreign_keys=ON')
for migration in sorted(pathlib.Path('drizzle').glob('*.sql')):
    if int(migration.name[:4])<35:db.executescript(migration.read_text())
db.executescript("""
INSERT INTO profiles(owner_id,name,currency) VALUES('owner','Owner','USD');
INSERT INTO accounts(id,owner_id,name,type,currency,opening_balance,opening_date) VALUES('a','owner','Cash','checking','USD',50000,'2026-01-01');
INSERT INTO recurring_entries(id,owner_id,name,account_id,amount,currency,bill_type,status,anchor_date,starts_on,expected_day_of_month,rules,end_mode,weekend_adjust,amount_strategy,notify_days_before,overdue_grace_days) VALUES('r','owner','Income','a',100000,'USD','income','active','2026-01-04','2026-01-04',4,'[]','never','none','fixed',3,3);
INSERT INTO account_statements(id,owner_id,account_id,title,currency,period_start,period_end,opening_balance,closing_balance,created_at,completed_at,snapshot_opening,snapshot_closing) VALUES('s','owner','a','Statement','USD','2026-01-01','2026-01-31',50000,50000,'2026-02-01','2026-02-01',50000,50000);
""")
tables=[r[0] for r in db.execute("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'")];columns={n:[r[1] for r in db.execute(f'PRAGMA table_info("{n}")')] for n in tables}
def rows(n):return db.execute('SELECT '+','.join('"'+c+'"' for c in columns[n])+' FROM "'+n+'"').fetchall()
before={n:rows(n) for n in tables};db.executescript(pathlib.Path('drizzle/0035_sloppy_earthquake.sql').read_text());assert all(rows(n)==value for n,value in before.items());assert db.execute('SELECT manual FROM recurring_entries').fetchone()==(None,);assert db.execute('SELECT cash_planning_excluded FROM accounts').fetchone()==(None,)
def guard(epoch):
 rev=db.execute("SELECT revision FROM profiles WHERE owner_id='owner'").fetchone()[0];db.execute("INSERT INTO workspace_guards(id,owner_id,expected_revision,client_epoch) VALUES('g','owner',?,?)",(rev,epoch))
def end():db.execute("DELETE FROM workspace_guards WHERE id='g'")
def rejected(sql,expected):
 try:db.execute(sql)
 except sqlite3.IntegrityError as error:assert expected in str(error),str(error)
 else:raise AssertionError(sql)
for epoch in [1,12,14,15]:
 guard(epoch);rejected('UPDATE recurring_entries SET manual=1','workspace_changed');rejected('UPDATE accounts SET cash_planning_excluded=1','workspace_changed');end()
guard(16);db.execute('UPDATE recurring_entries SET manual=1');db.execute('UPDATE accounts SET cash_planning_excluded=1');end();assert db.execute('SELECT review_required FROM account_statements').fetchone()[0]==0
for epoch in [3,5,7,9,11,13,15]:rejected(f"INSERT INTO workspace_guards(id,owner_id,expected_revision,client_epoch) SELECT 'g',owner_id,revision,{epoch} FROM profiles WHERE owner_id='owner'",'workspace_changed')
guard(16)
for command in ['UPDATE recurring_entries SET manual=2','UPDATE accounts SET cash_planning_excluded=-1']:rejected(command,'invalid_planning_flag')
db.execute("INSERT INTO transactions(id,owner_id,account_id,date,name,amount,kind) VALUES('manual','owner','a','2026-01-15','User entry',-100,'standard')");end();assert 'name' in db.execute("SELECT locked_fields FROM transactions WHERE id='manual'").fetchone()[0];assert db.execute('SELECT review_required FROM account_statements').fetchone()[0]==1
db.execute('UPDATE account_statements SET review_required=0');guard(17);db.execute("INSERT INTO transactions(id,owner_id,account_id,date,name,amount,kind,locked_fields) VALUES('restored','owner','a','2026-01-16','Restored',-100,'standard','[]')");end();assert db.execute("SELECT locked_fields FROM transactions WHERE id='restored'").fetchone()[0]=='[]';assert db.execute('SELECT review_required FROM account_statements').fetchone()[0]==0
guard(12);rejected('DELETE FROM recurring_entries','workspace_changed');rejected('DELETE FROM accounts','workspace_changed');end();guard(16);db.execute('DELETE FROM recurring_entries');end();assert db.execute('SELECT count(*) FROM transactions').fetchone()[0]==2;assert db.execute('PRAGMA foreign_key_check').fetchall()==[]
print('Paycheck upgrade verified: all prior rows/revisions preserved, unknown classification retained, guarded declarations/cash exclusions, obsolete restore protection, generation-16 manual locks and generation-17 statement/lock recovery.')
