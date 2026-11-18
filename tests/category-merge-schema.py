import sqlite3,json,sys
c=sqlite3.connect(sys.argv[1]);c.execute('PRAGMA foreign_keys=ON');owner='zero-schema-owner';checks=0
c.execute("INSERT INTO categories(id,owner_id,name,color) VALUES('merge-keep',?,'Keep','#112233')",(owner,))
def eq(a,b):
 global checks
 checks+=1;assert a==b,(a,b)
def guard(id,epoch=28,who=owner):c.execute('INSERT INTO workspace_guards(id,owner_id,expected_revision,client_epoch) SELECT ?,owner_id,revision,? FROM profiles WHERE owner_id=?',(id,epoch,who))
def clear():c.execute('DELETE FROM workspace_guards WHERE owner_id IN (?,?)',(owner,'category-merge-other'))
def category(id):c.execute('INSERT INTO categories(id,owner_id,name,color) VALUES(?,?,?,?)',(id,owner,id,'#334455'))
def rule(id,category):c.execute('INSERT INTO transaction_rules(id,owner_id,name,active,position,conditions,actions,source_json) VALUES(?,?,?,1,1,?,?,?)',(id,owner,id,json.dumps([dict(field='categoryId',operator='=',value=category)]),json.dumps([dict(type='categoryId',value=category)]),'{"original":"retain"}'))
category('ordinary');rule('ordinary-rule','ordinary');guard('ordinary-delete');c.execute("DELETE FROM categories WHERE id='ordinary'");clear();eq(c.execute("SELECT active,conditions,actions,source_json FROM transaction_rules WHERE id='ordinary-rule'").fetchone(),(0,'[]','[]','{"original":"retain"}'))
category('merge-source');rule('merge-rule','merge-source');c.execute("INSERT INTO transactions(id,owner_id,account_id,date,name,amount,kind,category_id,notes) VALUES('merge-tx',?,'zero-schema-account','2026-01-01','Keep figure',-123,'standard','merge-source','Notes')",(owner,));before=c.execute("SELECT amount,name,notes,import_key,reconciled_status FROM transactions WHERE id='merge-tx'").fetchone();guard('category-merge:fixture');c.execute("UPDATE transaction_rules SET conditions=?,actions=? WHERE id='merge-rule'",(json.dumps([dict(field='categoryId',operator='=',value='merge-keep')]),json.dumps([dict(type='categoryId',value='merge-keep')])));c.execute("UPDATE transactions SET category_id='merge-keep' WHERE id='merge-tx'");c.execute("DELETE FROM categories WHERE id='merge-source'");clear();eq(c.execute("SELECT active,source_json FROM transaction_rules WHERE id='merge-rule'").fetchone(),(1,'{"original":"retain"}'));eq(c.execute("SELECT amount,name,notes,import_key,reconciled_status FROM transactions WHERE id='merge-tx'").fetchone(),before);eq(c.execute("SELECT category_id FROM transactions WHERE id='merge-tx'").fetchone()[0],'merge-keep');eq('categoryId' in json.loads(c.execute("SELECT locked_fields FROM transactions WHERE id='merge-tx'").fetchone()[0]),True)
# A different owner's merge context cannot skip this owner's ordinary invalidator.
c.execute("INSERT INTO profiles(owner_id,name,currency,revision) VALUES('category-merge-other','Other','USD',0)");category('other-context');rule('other-rule','other-context');guard('category-merge:other',who='category-merge-other');guard('ordinary-other-owner');c.execute("DELETE FROM categories WHERE id='other-context'");clear();eq(c.execute("SELECT active FROM transaction_rules WHERE id='other-rule'").fetchone()[0],0)
for epoch in [6,8,27,37,38]:
 checks+=1
 try:guard('category-merge:wrong',epoch)
 except sqlite3.DatabaseError as e:assert 'workspace_changed' in str(e)
 else:raise AssertionError('Accepted wrong category merge epoch')
 clear()
for table,index in [('transactions','transactions_owner_category'),('split_lines','split_lines_owner_category'),('recurring_entries','recurring_entries_owner_category'),('budget_envelopes','budget_envelopes_owner_category'),('budgets','budgets_owner_category')]:
 eq([r[2] for r in c.execute('PRAGMA index_info('+index+')')],['owner_id','category_id']);plan=' '.join(str(r) for r in c.execute('EXPLAIN QUERY PLAN SELECT id FROM '+table+' WHERE owner_id=? AND category_id=?',(owner,'merge-keep')));eq(index in plan,True)
eq([r[2] for r in c.execute('PRAGMA index_info(categories_owner_parent)')],['owner_id','parent_id']);eq('categories_owner_parent' in ' '.join(str(r) for r in c.execute('EXPLAIN QUERY PLAN SELECT id FROM categories WHERE owner_id=? AND parent_id=?',(owner,'merge-keep'))),True)
eq(c.execute('PRAGMA foreign_key_check').fetchall(),[]);c.rollback();c.close();print(f'PASS {checks} SQLite ordinary-deletion invalidation, retained originals, protected merge context, manual lock/unchanged money, cross-owner isolation, wrong-epoch rejection and six indexed lookup plans.')
