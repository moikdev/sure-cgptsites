"""Preserve the previous investment schema and reject evidence-dropping clients."""
import sqlite3,pathlib,json
con=sqlite3.connect(':memory:');con.execute('PRAGMA foreign_keys=ON')
for migration in sorted(pathlib.Path('drizzle').glob('*.sql')):
    if int(migration.name[:4])<28:con.executescript(migration.read_text())
con.executescript("""
INSERT INTO profiles(owner_id,name,currency) VALUES('upgrade-fx','Upgrade','USD');
INSERT INTO accounts(id,owner_id,name,type,currency,opening_balance,opening_date) VALUES('a','upgrade-fx','Manual','investment','USD',10000,'2026-01-01');
INSERT INTO securities(id,owner_id,ticker,name) VALUES('s','upgrade-fx','ABC','Example');
INSERT INTO trades(id,owner_id,account_id,security_id,date,name,qty,price,fee,cash_amount,currency,activity,sequence) VALUES('t','upgrade-fx','a','s','2026-01-02','Native trade','1','1',0,-100,'USD','buy',1);
INSERT INTO holding_snapshots(id,owner_id,account_id,security_id,date,qty,price,amount,currency) VALUES('h','upgrade-fx','a','s','2026-01-02','1','1',100,'USD');
""")
tables=[r[0] for r in con.execute("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'")]
columns={name:[row[1] for row in con.execute(f'PRAGMA table_info("{name}")')] for name in tables}
def rows(name):return con.execute('SELECT '+','.join('"'+c+'"' for c in columns[name])+' FROM "'+name+'"').fetchall()
snapshot={name:rows(name) for name in tables};con.executescript(pathlib.Path('drizzle/0028_round_stone_men.sql').read_text());con.executescript(pathlib.Path('drizzle/0029_statement_review_epochs.sql').read_text());assert all(rows(name)==old for name,old in snapshot.items())
assert con.execute('SELECT conversion FROM trades').fetchone()[0] is None;assert con.execute('SELECT conversion FROM holding_snapshots').fetchone()[0] is None
con.execute("UPDATE trades SET conversion='{}' WHERE id='t'");con.execute("UPDATE holding_snapshots SET conversion='{}' WHERE id='h'");con.commit()
for command in ["UPDATE trades SET name='Lost evidence' WHERE id='t'","UPDATE holding_snapshots SET price='2' WHERE id='h'","DELETE FROM trades WHERE id='t'","UPDATE accounts SET currency='EUR' WHERE id='a'","UPDATE accounts SET opening_date='2026-01-03' WHERE id='a'"]:
    try:con.execute(command)
    except sqlite3.IntegrityError as e:assert 'workspace_changed' in str(e)
    else:raise AssertionError('Legacy edit unexpectedly succeeded: '+command)
revision=con.execute("SELECT revision FROM profiles WHERE owner_id='upgrade-fx'").fetchone()[0]
con.execute("INSERT INTO workspace_guards(id,owner_id,expected_revision,client_epoch) VALUES('guard','upgrade-fx',?,4)",(revision,));con.execute("UPDATE trades SET name='Modern edit' WHERE id='t'");con.execute("DELETE FROM holding_snapshots WHERE id='h'");con.execute("DELETE FROM workspace_guards WHERE id='guard'");assert con.execute('PRAGMA foreign_key_check').fetchall()==[]
print('Investment FX upgrade verified: prior rows/revisions preserved, nullable snapshots, older-client protection, account-currency/date guards and modern guarded mutations.')
