"""Verify opt-in migration, previous data preservation and guarded pricing writes."""
import sqlite3,pathlib
con=sqlite3.connect(':memory:');con.execute('PRAGMA foreign_keys=ON')
for migration in sorted(pathlib.Path('drizzle').glob('*.sql')):
    if int(migration.name[:4])<30:con.executescript(migration.read_text())
con.executescript("""
INSERT INTO profiles(owner_id,name,currency) VALUES('pricing-upgrade','Owner','USD');
INSERT INTO accounts(id,owner_id,name,type,currency,opening_balance,opening_date) VALUES('a','pricing-upgrade','Portfolio','investment','USD',10000,'2026-01-01');
INSERT INTO securities(id,owner_id,ticker,name) VALUES('s','pricing-upgrade','ABC','Example');
INSERT INTO trades(id,owner_id,account_id,security_id,date,name,qty,price,fee,cash_amount,currency,activity,sequence) VALUES('t','pricing-upgrade','a','s','2026-01-02','Buy','1','10',0,-1000,'USD','buy',1);
INSERT INTO security_prices(id,owner_id,security_id,date,currency,price) VALUES('p','pricing-upgrade','s','2026-01-03','EUR','12');
INSERT INTO exchange_rates(id,owner_id,date,from_currency,to_currency,rate,notes) VALUES('r','pricing-upgrade','2026-01-03','EUR','USD','1.2','');
INSERT INTO account_statements(id,owner_id,account_id,title,currency,period_start,period_end,opening_balance,closing_balance,created_at,completed_at,snapshot_opening,snapshot_closing) VALUES('statement','pricing-upgrade','a','Completed','USD','2026-01-01','2026-01-31',10000,10440,'2026-02-01T00:00:00Z','2026-02-01T00:00:00Z',10000,10440);
""")
tables=[r[0] for r in con.execute("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'")];columns={name:[r[1] for r in con.execute(f'PRAGMA table_info("{name}")')] for name in tables}
def old_rows(name):return con.execute('SELECT '+','.join('"'+c+'"' for c in columns[name])+' FROM "'+name+'"').fetchall()
before={name:old_rows(name) for name in tables};con.executescript(pathlib.Path('drizzle/0030_damp_dragon_lord.sql').read_text());assert all(old_rows(name)==rows for name,rows in before.items());assert con.execute('SELECT market_fx FROM profiles').fetchone()[0]==0

def guard(epoch):
    revision=con.execute("SELECT revision FROM profiles WHERE owner_id='pricing-upgrade'").fetchone()[0]
    con.execute("INSERT INTO workspace_guards(id,owner_id,expected_revision,client_epoch) VALUES('guard','pricing-upgrade',?,?)",(revision,epoch))
def end():con.execute("DELETE FROM workspace_guards WHERE id='guard'")
def rejected(sql):
    try:con.execute(sql)
    except sqlite3.IntegrityError as e:assert 'workspace_changed' in str(e)
    else:raise AssertionError(sql)
guard(6);con.execute('UPDATE profiles SET market_fx=1');end()
for command in ["UPDATE exchange_rates SET rate='2' WHERE id='r'","DELETE FROM security_prices WHERE id='p'","UPDATE trades SET qty='2' WHERE id='t'","UPDATE profiles SET market_fx=0"]:rejected(command)
guard(4);rejected("UPDATE security_prices SET price='13' WHERE id='p'");end()
guard(6);con.execute("UPDATE security_prices SET price='13' WHERE id='p'");assert con.execute('SELECT review_required FROM account_statements').fetchone()[0]==1;con.execute('UPDATE account_statements SET review_required=0');rejected('UPDATE profiles SET market_fx=2');end()
guard(7);con.execute("UPDATE security_prices SET price='14' WHERE id='p'");assert con.execute('SELECT review_required FROM account_statements').fetchone()[0]==0;end()
assert con.execute('PRAGMA foreign_key_check').fetchall()==[]
print('Market pricing upgrade verified: prior rows/revisions unchanged, default off, legacy writes blocked, ordinary edits flag statements and restore epoch preserves review state.')
