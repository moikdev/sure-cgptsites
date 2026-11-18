"""Verify additive price history, immutable values, safe unlinking and restore generations."""
import pathlib, sqlite3
db = sqlite3.connect(':memory:'); db.execute('PRAGMA foreign_keys=ON')
for migration in sorted(pathlib.Path('drizzle').glob('*.sql')):
    if int(migration.name[:4]) < 32: db.executescript(migration.read_text())
db.executescript("""
INSERT INTO profiles(owner_id,name,currency) VALUES('prices','Owner','USD');
INSERT INTO accounts(id,owner_id,name,type,currency,opening_balance,opening_date) VALUES('a','prices','Manual cash','checking','USD',100000,'2026-01-01');
INSERT INTO transactions(id,owner_id,account_id,date,name,amount,kind,notes) VALUES('t','prices','a','2026-02-01','Charge',-12000,'standard','');
INSERT INTO recurring_entries(id,owner_id,name,amount,currency,bill_type,status,anchor_date,starts_on,expected_day_of_month,rules,end_mode,weekend_adjust,amount_strategy,notify_days_before,overdue_grace_days) VALUES('r','prices','Bill',-10000,'USD','subscription','active','2026-01-01','2026-01-01',1,'[]','never','none','fixed',3,3);
INSERT INTO account_statements(id,owner_id,account_id,title,currency,period_start,period_end,opening_balance,closing_balance,created_at,completed_at,snapshot_opening,snapshot_closing) VALUES('statement','prices','a','Completed','USD','2026-01-01','2026-02-28',100000,88000,'2026-03-01T00:00:00Z','2026-03-01T00:00:00Z',100000,88000);
""")
tables = [r[0] for r in db.execute("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'")]
columns = {name:[r[1] for r in db.execute(f'PRAGMA table_info("{name}")')] for name in tables}
def rows(name): return db.execute('SELECT '+','.join('"'+c+'"' for c in columns[name])+' FROM "'+name+'"').fetchall()
before = {name:rows(name) for name in tables}
db.executescript(pathlib.Path('drizzle/0032_left_thanos.sql').read_text())
assert all(rows(name)==value for name,value in before.items())
assert db.execute('SELECT COUNT(*) FROM recurring_price_changes').fetchone()[0] == 0
def guard(epoch):
    revision=db.execute("SELECT revision FROM profiles WHERE owner_id='prices'").fetchone()[0]
    db.execute("INSERT INTO workspace_guards(id,owner_id,expected_revision,client_epoch) VALUES('g','prices',?,?)",(revision,epoch))
def end(): db.execute("DELETE FROM workspace_guards WHERE id='g'")
def rejected(sql, expected='workspace_changed'):
    try: db.execute(sql)
    except sqlite3.IntegrityError as error: assert expected in str(error), str(error)
    else: raise AssertionError(sql)
insert="INSERT INTO recurring_price_changes(id,owner_id,recurring_entry_id,effective_on,previous_amount,new_amount,currency,source,transaction_id) VALUES('h','prices','r','2026-02-01',10000,12000,'USD','detected','t')"
for epoch in [1,6,8,9]: guard(epoch); rejected(insert); end()
guard(10); db.execute(insert); end()
assert db.execute('SELECT review_required FROM account_statements').fetchone()[0] == 0
for command in ["UPDATE recurring_price_changes SET new_amount=13000", "UPDATE recurring_price_changes SET currency='EUR'", "UPDATE recurring_price_changes SET effective_on='2026-03-01'"]:
    rejected(command, 'immutable_recurring_price_history')
for epoch in [1,8,9]:
    guard(epoch); rejected('DELETE FROM recurring_price_changes'); rejected('DELETE FROM recurring_entries'); end()
guard(1); db.execute("DELETE FROM transactions WHERE id='t'"); end()
assert db.execute('SELECT transaction_id,previous_amount,new_amount FROM recurring_price_changes').fetchone() == (None,10000,12000)
assert db.execute('SELECT review_required FROM account_statements').fetchone()[0] == 1
db.execute('UPDATE account_statements SET review_required=0')
guard(11); db.execute('UPDATE accounts SET opening_balance=200000'); end()
assert db.execute('SELECT review_required FROM account_statements').fetchone()[0] == 0
guard(10); db.execute('UPDATE accounts SET opening_balance=300000'); end()
assert db.execute('SELECT review_required FROM account_statements').fetchone()[0] == 1
guard(10); db.execute("DELETE FROM recurring_entries WHERE id='r'"); end()
assert db.execute('SELECT COUNT(*) FROM recurring_price_changes').fetchone()[0] == 0
assert db.execute('PRAGMA foreign_key_check').fetchall() == []
print('Recurring price upgrade verified: every prior row/revision preserved, history immutable, legacy deletes/restores blocked, charge unlink retains snapshots, ordinary edits review statements and current restore preserves flags.')
