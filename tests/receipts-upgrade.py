"""Additive migration proof using a real SQLite database at the previous schema."""
import sqlite3, pathlib, json
con=sqlite3.connect(':memory:')
con.execute('PRAGMA foreign_keys=ON')
for migration in sorted(pathlib.Path('drizzle').glob('*.sql')):
    if int(migration.name[:4]) < 27:
        con.executescript(migration.read_text())
con.executescript("""
INSERT INTO profiles(owner_id,name,currency) VALUES('upgrade-receipts','Upgrade','USD');
INSERT INTO accounts(id,owner_id,name,type,currency,opening_balance,opening_date) VALUES('upgrade-account','upgrade-receipts','Manual','checking','USD',10000,'2026-01-01');
INSERT INTO transactions(id,owner_id,account_id,date,name,amount,kind) VALUES('upgrade-purchase','upgrade-receipts','upgrade-account','2026-02-01','Purchase',-100,'standard');
INSERT INTO statement_files(id,owner_id,filename,content_type,byte_size,sha256,upload_status,created_at,updated_at,storage_key) VALUES('upgrade-file','upgrade-receipts','receipt.pdf','application/pdf',20,printf('%064x',1),'ready','2026-02-01T00:00:00.000Z','2026-02-01T00:00:00.000Z','unchanged-private-key');
""")
tables=[row[0] for row in con.execute("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'")]
snapshot={name:con.execute(f'SELECT * FROM "{name}"').fetchall() for name in tables}
con.executescript(pathlib.Path('drizzle/0027_round_snowbird.sql').read_text())
assert all(con.execute(f'SELECT * FROM "{name}"').fetchall()==rows for name,rows in snapshot.items())
assert con.execute('PRAGMA foreign_key_check').fetchall()==[]
revision=con.execute("SELECT revision FROM profiles WHERE owner_id='upgrade-receipts'").fetchone()[0]
con.execute("INSERT INTO transaction_receipts VALUES ('upgrade-link','upgrade-receipts','upgrade-purchase','upgrade-file','2026-02-01T00:00:00.000Z')")
assert con.execute("SELECT revision FROM profiles WHERE owner_id='upgrade-receipts'").fetchone()[0]==revision+1
con.execute("DELETE FROM transactions WHERE id='upgrade-purchase'")
assert con.execute('SELECT count(*) FROM transaction_receipts').fetchone()[0]==0
assert con.execute("SELECT storage_key FROM statement_files WHERE id='upgrade-file'").fetchone()[0]=='unchanged-private-key'
print('Receipt upgrade verified: every previous table row/revision preserved, composite foreign keys valid, receipt tracking and link-only cascade work.')
