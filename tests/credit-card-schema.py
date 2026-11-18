"""Card metadata constraints against a disposable, migrated synthetic database."""
import sqlite3,json,sys
c=sqlite3.connect(sys.argv[1]);c.execute('PRAGMA foreign_keys=ON');checks=0;owner='zero-schema-owner'
def sql(s,p=()):return c.execute(s,p)
def eq(a,b):
 global checks
 checks+=1;assert a==b,(a,b)
def blocked(s,p=()):
 global checks
 checks+=1
 try:sql(s,p)
 except sqlite3.DatabaseError:return
 raise AssertionError('Accepted invalid card terms: '+str(p))
def revision():return sql('SELECT revision FROM profiles WHERE owner_id=?',(owner,)).fetchone()[0]
def terms(**patch):return dict(availableCredit=None,minimumPayment=None,annualFee=None,apr=None,expirationDate=None,statementCloseDay=31,dueDay=5,**{})|patch
def insert(value,id='card-test',who=owner):return sql('INSERT INTO credit_card_terms VALUES(?,?,?)',(who,id,json.dumps(value)))
def rows():return sql("SELECT terms_json FROM credit_card_terms WHERE account_id='card-test'").fetchall()
for id,type in [('card-test','credit'),('card-other','credit'),('card-cash','checking')]:sql('INSERT INTO accounts(id,owner_id,name,type,currency,opening_balance,opening_date) VALUES(?,?,?,?,?,?,?)',(id,owner,id,type,'USD',-10000,'2020-01-01'))
eq(rows(),[])
for patch in [{'minimumPayment':-1},{'availableCredit':1000000000001},{'annualFee':1.1},{'annualFee':True},{'statementCloseDay':0},{'dueDay':32},{'dueDay':'5'},{'apr':'01'},{'apr':'1.'},{'apr':'.5'},{'apr':'1.00'},{'apr':'-1'},{'apr':'100000000'},{'apr':'1e2'},{'apr':'1.2.3'},{'apr':'12.345'},{'apr':12},{'expirationDate':'2026-02-30'},{'expirationDate':'1899-12-31'},{'expirationDate':'2200-01-01'},{'unknown':0}]:blocked('INSERT INTO credit_card_terms VALUES(?,?,?)',(owner,'card-test',json.dumps(terms(**patch))))
for value in [{},dict.fromkeys(terms(),None),{k:v for k,v in terms().items() if k!='apr'},[],None]:blocked('INSERT INTO credit_card_terms VALUES(?,?,?)',(owner,'card-test',json.dumps(value)))
blocked('INSERT INTO credit_card_terms VALUES(?,?,?)',(owner,'card-test',json.dumps(terms())[:-1]+',"apr":null}'))
for who,id in [('foreign','card-test'),(owner,'missing'),(owner,'card-cash')]:blocked('INSERT INTO credit_card_terms VALUES(?,?,?)',(who,id,json.dumps(terms())))
before=revision();insert(terms(availableCredit=0,minimumPayment=100,annualFee=0,apr='18.9',expirationDate='2024-02-29'));eq(revision(),before+1);eq(len(rows()),1)
for s in ["UPDATE credit_card_terms SET account_id='card-other' WHERE account_id='card-test'","UPDATE credit_card_terms SET owner_id='foreign' WHERE account_id='card-test'","UPDATE accounts SET currency='JPY' WHERE id='card-test'"]:blocked(s)
before=revision();sql('UPDATE credit_card_terms SET terms_json=terms_json');eq(revision(),before)
sql('UPDATE credit_card_terms SET terms_json=? WHERE account_id=?',(json.dumps(terms(apr='0',minimumPayment=0)),'card-test'));eq(revision(),before+1);blocked("UPDATE accounts SET currency='JPY' WHERE id='card-test'")
before=revision();sql('INSERT INTO workspace_guards(id,owner_id,expected_revision,client_epoch) VALUES(?,?,?,37)',('category-restore:card-test',owner,before));sql('UPDATE credit_card_terms SET terms_json=? WHERE account_id=?',(json.dumps(terms(apr='99999999.99')),'card-test'));eq(revision(),before);sql('UPDATE profiles SET revision=revision+1 WHERE owner_id=?',(owner,));sql('DELETE FROM workspace_guards WHERE owner_id=?',(owner,));eq(revision(),before+1)
sql("UPDATE accounts SET currency='JPY' WHERE id='card-test'");eq(sql("SELECT currency FROM accounts WHERE id='card-test'").fetchone()[0],'JPY');sql("UPDATE accounts SET type='loan' WHERE id='card-test'");eq(rows(),[]);eq(sql("SELECT opening_balance FROM accounts WHERE id='card-test'").fetchone()[0],-10000)
insert(terms(apr='0.01'),'card-other');sql("DELETE FROM accounts WHERE id='card-other'");eq(sql("SELECT count(*) FROM credit_card_terms WHERE account_id='card-other'").fetchone()[0],0)
eq(sql('PRAGMA foreign_key_check').fetchall(),[])
print(f'{checks} SQLite card JSON/precision/calendar/parent/identity/revision/guard/currency/type/cascade checks passed; physical opening balance unchanged.');c.rollback();c.close()
