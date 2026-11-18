import sqlite3,json,sys
c=sqlite3.connect(sys.argv[1]);c.execute('PRAGMA foreign_keys=ON');owner='zero-schema-owner';checks=0
def sql(s,p=()):return c.execute(s,p)
def eq(a,b):
 global checks
 checks+=1;assert a==b,(a,b)
def blocked(s,p=()):
 global checks
 checks+=1
 try:sql(s,p)
 except sqlite3.DatabaseError:return
 raise AssertionError('Accepted invalid asset metadata '+str(p))
def vehicle(**p):return dict(kind='vehicle',make='Toyota',model=None,year=None,mileageValue=None,mileageUnit=None)|p
def prop(**p):return dict(kind='property',yearBuilt=1900,areaValue=None,areaUnit=None,address=None)|p
def rev():return sql('SELECT revision FROM profiles WHERE owner_id=?',(owner,)).fetchone()[0]
for id,type in [('asset-car','vehicle'),('asset-home','property'),('asset-cash','checking')]:sql('INSERT INTO accounts(id,owner_id,name,type,currency,opening_balance,opening_date) VALUES(?,?,?,?,?,?,?)',(id,owner,id,type,'USD',10000,'2020-01-01'))
for id,who,d in [('asset-car','foreign',vehicle()),('missing',owner,vehicle()),('asset-cash',owner,vehicle()),('asset-car',owner,prop())]:blocked('INSERT INTO manual_asset_details VALUES(?,?,?)',(who,id,json.dumps(d)))
for p in [{'make':''},{'make':' a'},{'make':'a\nb'},{'make':'a\0b'},{'make':'a'*201},{'year':1899},{'year':2200},{'mileageValue':-1},{'mileageValue':1.5},{'mileageValue':2147483648},{'mileageValue':True},{'mileageUnit':'miles'},{'kind':'other'},{'unknown':1}]:blocked('INSERT INTO manual_asset_details VALUES(?,?,?)',(owner,'asset-car',json.dumps(vehicle(**p))))
for d in [{},{'kind':'vehicle'},dict.fromkeys(vehicle(),None)|{'kind':'vehicle'},{k:v for k,v in vehicle().items() if k!='year'}]:blocked('INSERT INTO manual_asset_details VALUES(?,?,?)',(owner,'asset-car',json.dumps(d)))
blocked('INSERT INTO manual_asset_details VALUES(?,?,?)',(owner,'asset-car',json.dumps(vehicle())[:-1]+',"year":null}'))
for p in [{'yearBuilt':1499},{'yearBuilt':2200},{'areaValue':-1},{'areaUnit':'acre'},{'address':{}},{'address':[]},{'address':dict.fromkeys(['line1','line2','locality','region','country','postalCode','county'],None)},{'address':dict.fromkeys(['line1','line2','locality','region','country','postalCode','county'],'a')|{'extra':'x'}}]:blocked('INSERT INTO manual_asset_details VALUES(?,?,?)',(owner,'asset-home',json.dumps(prop(**p))))
before=rev();sql('INSERT INTO manual_asset_details VALUES(?,?,?)',(owner,'asset-car',json.dumps(vehicle(mileageValue=0,mileageUnit='km'))));eq(rev(),before+1);before=rev();sql('UPDATE manual_asset_details SET details_json=details_json');eq(rev(),before)
blocked("UPDATE manual_asset_details SET account_id='asset-home'");blocked("UPDATE manual_asset_details SET owner_id='foreign'")
sql('INSERT INTO workspace_guards(id,owner_id,expected_revision,client_epoch) VALUES(?,?,?,37)',('category-restore:asset-test',owner,before));sql('UPDATE manual_asset_details SET details_json=?',(json.dumps(vehicle(model='Prius')),));eq(rev(),before);sql('UPDATE profiles SET revision=revision+1 WHERE owner_id=?',(owner,));sql('DELETE FROM workspace_guards WHERE owner_id=?',(owner,));eq(rev(),before+1)
sql("UPDATE accounts SET archived=1 WHERE id='asset-car'");eq(sql("SELECT count(*) FROM manual_asset_details WHERE account_id='asset-car'").fetchone()[0],1);sql("UPDATE accounts SET type='property' WHERE id='asset-car'");eq(sql("SELECT count(*) FROM manual_asset_details WHERE account_id='asset-car'").fetchone()[0],0)
sql('INSERT INTO manual_asset_details VALUES(?,?,?)',(owner,'asset-home',json.dumps(prop(areaValue=0,areaUnit='sqm'))));sql("DELETE FROM accounts WHERE id='asset-home'");eq(sql("SELECT count(*) FROM manual_asset_details WHERE account_id='asset-home'").fetchone()[0],0);eq(sql("SELECT opening_balance FROM accounts WHERE id='asset-car'").fetchone()[0],10000);eq(sql('PRAGMA foreign_key_check').fetchall(),[])
print(f'{checks} SQLite manual-asset JSON/text/integer/unit/address/parent/identity/revision/guard/archive/family/cascade checks passed; financial opening unchanged.');c.rollback();c.close()
