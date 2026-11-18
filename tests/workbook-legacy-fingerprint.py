"""Compare every original column while separately checking the new nullable source field."""
from pathlib import Path
import json,sqlite3,sys
namespace={};source=Path('tests/zero-upgrade-fixture.py').read_text().split('mode,target,output=')[0];exec(source,namespace)
c=sqlite3.connect(sys.argv[1]);original=namespace['schema'];namespace['schema']=lambda c:{t:[x for x in cols if t!='csv_imports' or x!='workbook_source_json'] for t,cols in original(c).items()}
assert [r for r in c.execute('PRAGMA table_info(csv_imports)') if r[1]=='workbook_source_json']==[(len(original(c)['csv_imports'])-1,'workbook_source_json','TEXT',0,None,0)]
assert c.execute('SELECT count(*) FROM csv_imports WHERE workbook_source_json IS NOT NULL').fetchone()[0]==0
Path(sys.argv[2]).write_text(json.dumps(namespace['fingerprint'](c)));c.close()
