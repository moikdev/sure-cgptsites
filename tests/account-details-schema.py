"""Constraints and revision/type transitions in an isolated synthetic database."""
import sqlite3,sys
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
 raise AssertionError('Accepted invalid account details: '+s)
def revision():return sql('SELECT revision FROM profiles WHERE owner_id=?',(owner,)).fetchone()[0]
def details(id):return sql('SELECT subtype,crypto_tax_treatment FROM account_details WHERE owner_id=? AND account_id=?',(owner,id)).fetchall()
for id,type in [('details-crypto','crypto'),('details-investment','investment'),('details-cash','checking')]:sql('INSERT INTO accounts(id,owner_id,name,type,currency,opening_balance,opening_date) VALUES(?,?,?,?,?,?,?)',(id,owner,id,type,'USD',10000,'2020-01-01'))
eq(details('zero-schema-account'),[]);eq(sql("SELECT archived_on FROM account_archive_dates WHERE account_id='zero-schema-account'").fetchone()[0],'2024-02-29')
for who,id,subtype,tax in [('foreign','details-crypto','wallet','tax_exempt'),(owner,'missing','ira',None),(owner,'details-cash','hsa','tax_exempt'),(owner,'details-investment','ira','tax_deferred'),(owner,'details-crypto','wallet','invalid'),(owner,'details-crypto',None,None),(owner,'details-crypto','',None),(owner,'details-crypto',' hsa',None),(owner,'details-crypto','hsa ',None),(owner,'details-crypto','a\nb',None),(owner,'details-crypto','a\0b',None),(owner,'details-crypto','a'*81,None)]:blocked('INSERT INTO account_details VALUES(?,?,?,?)',(who,id,subtype,tax))
before=revision();sql('INSERT INTO account_details VALUES(?,?,?,?)',(owner,'details-crypto','wallet','tax_exempt'));eq(details('details-crypto'),[('wallet','tax_exempt')]);eq(revision(),before+1)
blocked("UPDATE account_details SET account_id='details-cash' WHERE account_id='details-crypto'");blocked("UPDATE account_details SET owner_id='other' WHERE account_id='details-crypto'");blocked("UPDATE account_details SET crypto_tax_treatment='tax_advantaged' WHERE account_id='details-crypto'")
before=revision();sql("UPDATE account_details SET subtype='wallet',crypto_tax_treatment='tax_exempt' WHERE account_id='details-crypto'");eq(revision(),before);sql("UPDATE account_details SET crypto_tax_treatment='tax_deferred' WHERE account_id='details-crypto'");eq(revision(),before+1)
before=revision();sql('INSERT INTO workspace_guards(id,owner_id,expected_revision,client_epoch) VALUES(?,?,?,37)',('category-restore:details-test',owner,before));sql("UPDATE account_details SET subtype='exchange' WHERE account_id='details-crypto'");eq(revision(),before);sql('UPDATE profiles SET revision=revision+1 WHERE owner_id=?',(owner,));sql('DELETE FROM workspace_guards WHERE owner_id=?',(owner,));eq(revision(),before+1)
sql("UPDATE accounts SET type='investment' WHERE id='details-crypto'");eq(details('details-crypto'),[])
sql('INSERT INTO account_details VALUES(?,?,?,?)',(owner,'details-cash','hsa',None));sql("UPDATE accounts SET type='savings' WHERE id='details-cash'");eq(details('details-cash'),[('hsa',None)]);sql("UPDATE accounts SET type='loan' WHERE id='details-cash'");eq(details('details-cash'),[])
sql('INSERT INTO account_details VALUES(?,?,?,?)',(owner,'details-investment','future_subtype',None));eq(details('details-investment'),[('future_subtype',None)]);sql("DELETE FROM accounts WHERE id='details-investment'");eq(details('details-investment'),[])
eq(sql("SELECT opening_balance FROM accounts WHERE id='details-cash'").fetchone()[0],10000);eq(sql('PRAGMA foreign_key_check').fetchall(),[])
print(f'{checks} SQLite account-detail text/crypto/parent/identity/revision/guard/type-family/cascade checks passed; physical opening balances unchanged.')
c.rollback();c.close()
