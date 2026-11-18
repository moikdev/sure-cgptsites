"""Prove lifecycle upgrade preserves old data and guards newer date metadata."""
import pathlib, sqlite3

db=sqlite3.connect(':memory:');db.execute('PRAGMA foreign_keys=ON')
for migration in sorted(pathlib.Path('drizzle').glob('*.sql')):
    if int(migration.name[:4])<34:db.executescript(migration.read_text())
db.executescript("""
INSERT INTO profiles(owner_id,name,currency) VALUES('owner','Owner','USD');
INSERT INTO accounts(id,owner_id,name,type,currency,opening_balance,opening_date) VALUES('a','owner','Cash','checking','USD',100000,'2026-01-01');
INSERT INTO transactions(id,owner_id,account_id,date,name,amount,kind) VALUES('t','owner','a','2026-01-15','Bill',-10000,'standard');
INSERT INTO recurring_entries(id,owner_id,name,account_id,amount,currency,bill_type,status,anchor_date,starts_on,expected_day_of_month,rules,end_mode,weekend_adjust,amount_strategy,notify_days_before,overdue_grace_days) VALUES('r','owner','Bill','a',-10000,'USD','subscription','active','2026-01-15','2026-01-15',15,'[]','never','none','fixed',3,3);
INSERT INTO recurring_occurrences(id,owner_id,recurring_entry_id,original_due_on,due_on,currency,status) VALUES('o','owner','r','2026-01-15','2026-01-15','USD','scheduled');
INSERT INTO account_statements(id,owner_id,account_id,title,currency,period_start,period_end,opening_balance,closing_balance,created_at,completed_at,snapshot_opening,snapshot_closing) VALUES('s','owner','a','Completed','USD','2026-01-01','2026-01-31',100000,90000,'2026-02-01','2026-02-01',100000,90000);
""")
tables=[r[0] for r in db.execute("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'")];columns={name:[r[1] for r in db.execute(f'PRAGMA table_info("{name}")')] for name in tables}
def rows(name):return db.execute('SELECT '+','.join('"'+c+'"' for c in columns[name])+' FROM "'+name+'"').fetchall()
before={name:rows(name) for name in tables}
db.executescript(pathlib.Path('drizzle/0034_first_cargill.sql').read_text());assert all(rows(name)==value for name,value in before.items())
assert db.execute('SELECT renews_on,trial_ends_on,cancelled_on FROM recurring_entries').fetchone()==(None,None,None)
def guard(epoch):
    rev=db.execute("SELECT revision FROM profiles WHERE owner_id='owner'").fetchone()[0];db.execute("INSERT INTO workspace_guards(id,owner_id,expected_revision,client_epoch) VALUES('g','owner',?,?)",(rev,epoch))
def end():db.execute("DELETE FROM workspace_guards WHERE id='g'")
def rejected(sql,expected):
    try:db.execute(sql)
    except sqlite3.IntegrityError as error:assert expected in str(error),str(error)
    else:raise AssertionError(sql)
for epoch in [1,10,12,13]:
    guard(epoch);rejected("UPDATE recurring_entries SET cancelled_on='2026-01-10'",'workspace_changed');end()
guard(14);db.execute("UPDATE recurring_entries SET trial_ends_on='2026-01-20',renews_on='2026-02-01',cancelled_on='2026-01-10'");end()
assert db.execute('SELECT status FROM recurring_entries').fetchone()[0]=='active'
assert db.execute('SELECT status FROM recurring_occurrences').fetchone()[0]=='scheduled'
assert db.execute('SELECT review_required FROM account_statements').fetchone()[0]==0
for epoch in [3,5,7,9,11,13]:rejected(f"INSERT INTO workspace_guards(id,owner_id,expected_revision,client_epoch) SELECT 'g',owner_id,revision,{epoch} FROM profiles WHERE owner_id='owner'",'workspace_changed')
for epoch in [1,10,12]:
    guard(epoch);rejected('DELETE FROM recurring_entries','workspace_changed');end()
guard(14)
for date in ['2026-02-30','2026-13-01','2026-01-01T00:00:00Z','1899-12-31','2200-01-01','bad','2026-1-01']:rejected(f"UPDATE recurring_entries SET trial_ends_on='{date}'",'invalid_lifecycle_date')
db.execute("UPDATE recurring_entries SET trial_ends_on='2028-02-29'");end()
# Ordinary editors preserve dates, without being mistaken for full restores.
guard(12);db.execute("UPDATE recurring_entries SET name='Renamed',renews_on=renews_on,trial_ends_on=trial_ends_on,cancelled_on=cancelled_on");db.execute("UPDATE transactions SET amount=-9999 WHERE id='t'");end();assert db.execute('SELECT review_required FROM account_statements').fetchone()[0]==1
db.execute('UPDATE account_statements SET review_required=0');guard(15);db.execute("UPDATE transactions SET amount=-10000 WHERE id='t'");end();assert db.execute('SELECT review_required FROM account_statements').fetchone()[0]==0
guard(14);db.execute('DELETE FROM recurring_entries');end();assert db.execute('SELECT count(*) FROM recurring_occurrences').fetchone()[0]==0;assert db.execute('SELECT count(*) FROM transactions').fetchone()[0]==1
assert db.execute('PRAGMA foreign_key_check').fetchall()==[]
print('Lifecycle upgrade verified: prior rows/revisions preserved, real calendar dates validated, metadata leaves schedules and payments unchanged, obsolete restores/deletes blocked, ordinary edits request review and generation-15 recovery retains flags.')
