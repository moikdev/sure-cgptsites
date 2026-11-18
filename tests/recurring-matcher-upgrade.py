"""Additive matcher upgrade, shared capacity, metadata recovery and write-generation semantics."""
import pathlib, sqlite3, json

db=sqlite3.connect(':memory:');db.execute('PRAGMA foreign_keys=ON')
for migration in sorted(pathlib.Path('drizzle').glob('*.sql')):
    if int(migration.name[:4])<33:db.executescript(migration.read_text())
db.executescript("""
INSERT INTO profiles(owner_id,name,currency) VALUES('owner','Owner','USD');
INSERT INTO accounts(id,owner_id,name,type,currency,opening_balance,opening_date) VALUES('a','owner','Cash','checking','USD',100000,'2026-01-01');
INSERT INTO transactions(id,owner_id,account_id,date,name,amount,kind) VALUES('t','owner','a','2026-01-15','Bill',-10000,'standard');
INSERT INTO recurring_entries(id,owner_id,name,account_id,amount,currency,bill_type,status,anchor_date,starts_on,expected_day_of_month,rules,end_mode,weekend_adjust,amount_strategy,notify_days_before,overdue_grace_days) VALUES('r','owner','Bill','a',-10000,'USD','bill','active','2026-01-15','2026-01-15',15,'[]','never','none','fixed',3,3);
INSERT INTO recurring_occurrences(id,owner_id,recurring_entry_id,original_due_on,due_on,currency,status) VALUES('o','owner','r','2026-01-15','2026-01-15','USD','scheduled');
INSERT INTO recurring_allocations(id,owner_id,occurrence_id,transaction_id,amount,currency,state,source) VALUES('p','owner','o','t',3000,'USD','confirmed','user_created');
INSERT INTO account_statements(id,owner_id,account_id,title,currency,period_start,period_end,opening_balance,closing_balance,created_at,completed_at,snapshot_opening,snapshot_closing) VALUES('s','owner','a','Completed','USD','2026-01-01','2026-01-31',100000,90000,'2026-02-01','2026-02-01',100000,90000);
""")
tables=[r[0] for r in db.execute("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'")]
columns={name:[r[1] for r in db.execute(f'PRAGMA table_info("{name}")')] for name in tables}
def rows(name):return db.execute('SELECT '+','.join('"'+c+'"' for c in columns[name])+' FROM "'+name+'"').fetchall()
before={name:rows(name) for name in tables}
db.executescript(pathlib.Path('drizzle/0033_flowery_slapstick.sql').read_text());assert all(rows(name)==value for name,value in before.items())
assert db.execute('SELECT matching FROM recurring_entries').fetchone()==(None,)
assert db.execute('SELECT match_confidence,match_signals FROM recurring_allocations').fetchone()==(None,None)
assert db.execute('SELECT count(*) FROM recurring_match_rejections').fetchone()[0]==0

def guard(epoch):
    revision=db.execute("SELECT revision FROM profiles WHERE owner_id='owner'").fetchone()[0]
    db.execute("INSERT INTO workspace_guards(id,owner_id,expected_revision,client_epoch) VALUES('g','owner',?,?)",(revision,epoch))
def end():db.execute("DELETE FROM workspace_guards WHERE id='g'")
def rejected(sql,expected):
    try:db.execute(sql)
    except sqlite3.IntegrityError as error:assert expected in str(error),str(error)
    else:raise AssertionError(sql)
# Both states reserve capacity; ended rows release it.
guard(12)
db.execute("INSERT INTO recurring_allocations(id,owner_id,occurrence_id,transaction_id,amount,currency,state,source) VALUES('suggested','owner','o','t',7000,'USD','suggested','auto_matched')")
rejected("INSERT INTO recurring_allocations(id,owner_id,occurrence_id,transaction_id,amount,currency,state,source) VALUES('excess','owner','o','t',1,'USD','suggested','auto_matched')",'payment_capacity')
db.execute("UPDATE recurring_entries SET status='ended'")
db.execute("INSERT INTO recurring_allocations(id,owner_id,occurrence_id,transaction_id,amount,currency,state,source) VALUES('released','owner','o','t',1,'USD','suggested','auto_matched')")
rejected("UPDATE recurring_entries SET status='active'",'payment_capacity')
db.execute("DELETE FROM recurring_allocations WHERE id='released'");db.execute("UPDATE recurring_entries SET status='active'");end()
# Rejection-only metadata also blocks obsolete destructive restores.
db.execute("INSERT INTO recurring_match_rejections(id,owner_id,recurring_entry_id,transaction_id) VALUES('reject','owner','r','t')")
for epoch in [3,5,7,9,11]:
    rejected(f"INSERT INTO workspace_guards(id,owner_id,expected_revision,client_epoch) SELECT 'g',owner_id,revision,{epoch} FROM profiles WHERE owner_id='owner'",'workspace_changed')
rejected("INSERT INTO recurring_match_rejections(id,owner_id,recurring_entry_id,transaction_id) VALUES('duplicate','owner','r','t')",'UNIQUE')
rejected("UPDATE recurring_match_rejections SET id='changed'",'immutable_match_rejection')
# Enabled settings survive old editors and allocations validate finite confidence ranges.
guard(12);db.execute('UPDATE recurring_entries SET matching=?',(json.dumps({'enabled':True}),));end()
guard(1);rejected("UPDATE recurring_entries SET name='Old edit'",'workspace_changed');rejected('DELETE FROM recurring_entries','workspace_changed');end()
rejected('UPDATE recurring_allocations SET match_confidence=10001','invalid_matching_evidence')
guard(12);db.execute("UPDATE recurring_allocations SET match_confidence=9500,match_signals='{}' WHERE id='p'");end()
guard(1);rejected("UPDATE recurring_allocations SET match_confidence=0 WHERE id='p'",'workspace_changed');end()
# Modern ordinary writes still lock manual descriptions and request statement review.
guard(12);db.execute("INSERT INTO transactions(id,owner_id,account_id,date,name,amount,kind) VALUES('manual','owner','a','2026-01-16','Manual',-1,'standard')");end()
assert json.loads(db.execute("SELECT locked_fields FROM transactions WHERE id='manual'").fetchone()[0])==['name']
assert db.execute('SELECT review_required FROM account_statements').fetchone()[0]==1
# Modern complete restore preserves both restored locks and restored reconciliation flags.
db.execute('UPDATE account_statements SET review_required=0');guard(13)
db.execute("INSERT INTO transactions(id,owner_id,account_id,date,name,amount,kind,locked_fields) VALUES('restored','owner','a','2026-01-17','Restored',-1,'standard','[]')");end()
assert json.loads(db.execute("SELECT locked_fields FROM transactions WHERE id='restored'").fetchone()[0])==[]
assert db.execute('SELECT review_required FROM account_statements').fetchone()[0]==0
# Root/split consistency and mixed capacity remain protected.
db.execute("INSERT INTO split_lines(id,owner_id,transaction_id,position,name,amount) VALUES('part','owner','manual',0,'Part',-1)")
rejected("INSERT INTO recurring_match_rejections(id,owner_id,recurring_entry_id,transaction_id,split_line_id) VALUES('bad-part','owner','r','t','part')",'invalid_match_rejection')
# Source removal legitimately cascades pair memory while retaining allocations without links.
guard(12);db.execute("UPDATE recurring_allocations SET transaction_id=NULL WHERE transaction_id='t'");db.execute("DELETE FROM transactions WHERE id='t'");end()
assert db.execute('SELECT count(*) FROM recurring_match_rejections').fetchone()[0]==0
assert db.execute('PRAGMA foreign_key_check').fetchall()==[]
print('Matcher upgrade verified: old rows/revisions unchanged; shared suggested/confirmed capacity, reactivation guards, immutable rejections, old restore/editor protection, finite evidence, manual locks and restore statement flags.')
