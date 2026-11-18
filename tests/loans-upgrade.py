"""Prove additive loan metadata preserves old rows and separates write generations."""
import json, pathlib, sqlite3
db = sqlite3.connect(':memory:')
db.execute('PRAGMA foreign_keys=ON')
for migration in sorted(pathlib.Path('drizzle').glob('*.sql')):
    if int(migration.name[:4]) < 31:
        db.executescript(migration.read_text())
db.executescript("""
INSERT INTO profiles(owner_id,name,currency) VALUES('loans','Owner','USD');
INSERT INTO accounts(id,owner_id,name,type,currency,opening_balance,opening_date) VALUES('loan','loans','Mortgage','loan','USD',-90000,'2026-01-01');
INSERT INTO account_statements(id,owner_id,account_id,title,currency,period_start,period_end,opening_balance,closing_balance,created_at,completed_at,snapshot_opening,snapshot_closing) VALUES('statement','loans','loan','Completed','USD','2026-01-01','2026-01-31',-90000,-90000,'2026-02-01T00:00:00Z','2026-02-01T00:00:00Z',-90000,-90000);
""")
tables = [r[0] for r in db.execute("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'")]
columns = {table: [r[1] for r in db.execute(f'PRAGMA table_info("{table}")')] for table in tables}
def rows(table): return db.execute('SELECT '+','.join('"'+c+'"' for c in columns[table])+' FROM "'+table+'"').fetchall()
before = {table: rows(table) for table in tables}
db.executescript(pathlib.Path('drizzle/0031_funny_felicia_hardy.sql').read_text())
assert all(rows(table) == value for table, value in before.items())
assert db.execute('SELECT loan_terms FROM accounts').fetchone()[0] is None
def guard(epoch):
    revision = db.execute("SELECT revision FROM profiles WHERE owner_id='loans'").fetchone()[0]
    db.execute("INSERT INTO workspace_guards(id,owner_id,expected_revision,client_epoch) VALUES('guard','loans',?,?)", (revision, epoch))
def end(): db.execute("DELETE FROM workspace_guards WHERE id='guard'")
def rejected(sql, args=(), expected='workspace_changed'):
    try: db.execute(sql, args)
    except sqlite3.IntegrityError as error: assert expected in str(error)
    else: raise AssertionError(sql)
terms = json.dumps({'initialBalance':120000,'startDate':'2025-01-01'})
for epoch in [1,4,6,7]:
    guard(epoch); rejected('UPDATE accounts SET loan_terms=?', (terms,)); end()
guard(8); db.execute('UPDATE accounts SET loan_terms=?', (terms,)); end()
assert db.execute('SELECT review_required FROM account_statements').fetchone()[0] == 0
for epoch in [1,4,6,7]:
    guard(epoch); rejected('UPDATE accounts SET loan_terms=NULL'); rejected('DELETE FROM accounts'); end()
rejected("UPDATE accounts SET currency='JPY'", expected='loan_terms_require_original_currency_and_type')
guard(8); rejected("UPDATE accounts SET loan_terms='not json'", expected='invalid_loan_terms'); rejected("UPDATE accounts SET loan_terms='[]'", expected='invalid_loan_terms'); db.execute('UPDATE accounts SET opening_balance=-80000'); end()
assert db.execute('SELECT review_required FROM account_statements').fetchone()[0] == 1
db.execute('UPDATE account_statements SET review_required=0')
guard(9); db.execute('UPDATE accounts SET opening_balance=-70000'); end()
assert db.execute('SELECT review_required FROM account_statements').fetchone()[0] == 0
guard(8); db.execute('UPDATE accounts SET loan_terms=NULL'); db.execute("INSERT INTO accounts(id,owner_id,name,type,currency,opening_balance,opening_date) VALUES('empty','loans','Empty','loan','USD',-100,'2026-01-01')"); db.execute("UPDATE accounts SET currency='EUR' WHERE id='empty'"); end()
assert db.execute('PRAGMA foreign_key_check').fetchall() == []
print('Loan upgrade verified: all old columns/rows/revisions preserved, nullable default, older writes/restores protected, contract currency guarded, ordinary changes flag statements and current restore preserves review state.')
