ALTER TABLE csv_imports ADD COLUMN workbook_source_json TEXT;
--> statement-breakpoint
CREATE TRIGGER workbook_source_immutable BEFORE UPDATE OF workbook_source_json ON csv_imports
WHEN OLD.workbook_source_json IS NOT NEW.workbook_source_json
BEGIN SELECT RAISE(ABORT,'workbook_source_immutable'); END;
--> statement-breakpoint
CREATE TRIGGER workbook_source_insert BEFORE INSERT ON csv_imports
WHEN NEW.workbook_source_json IS NOT NULL AND CASE WHEN json_valid(NEW.workbook_source_json)=0 THEN 1 ELSE COALESCE((
 length(NEW.workbook_source_json)<=1000000 AND json_type(NEW.workbook_source_json)='object'
 AND json_extract(NEW.workbook_source_json,'$.extraction.parser')='sure-xlsx-v1'
 AND json_extract(NEW.workbook_source_json,'$.csvSHA256')=NEW.sha256
 AND json_extract(NEW.workbook_source_json,'$.csvByteSize')=NEW.byte_size
 AND json_type(NEW.workbook_source_json,'$.extraction.sourceRows')='array'
 AND json_array_length(NEW.workbook_source_json,'$.extraction.sourceRows') BETWEEN 1 AND 10000
 AND json_extract(NEW.workbook_source_json,'$.extraction.rows')=json_array_length(NEW.workbook_source_json,'$.extraction.sourceRows')
 AND json_extract(NEW.workbook_source_json,'$.extraction.options.sheetId')=json_extract(NEW.workbook_source_json,'$.extraction.sheet.id')
 AND EXISTS (SELECT 1 FROM statement_files f WHERE f.owner_id=NEW.owner_id AND f.id=json_extract(NEW.workbook_source_json,'$.file.id') AND f.sha256=json_extract(NEW.workbook_source_json,'$.file.sha256') AND f.byte_size=json_extract(NEW.workbook_source_json,'$.file.byteSize') AND f.filename=json_extract(NEW.workbook_source_json,'$.file.filename') AND f.upload_status='ready' AND f.content_type='application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
 ),0)=0 END
BEGIN SELECT RAISE(ABORT,'workbook_source_invalid'); END;
--> statement-breakpoint
CREATE TRIGGER workbook_source_binding BEFORE UPDATE OF owner_id,sha256,byte_size ON csv_imports
WHEN OLD.workbook_source_json IS NOT NULL AND (OLD.owner_id IS NOT NEW.owner_id OR OLD.sha256 IS NOT NEW.sha256 OR OLD.byte_size IS NOT NEW.byte_size)
BEGIN SELECT RAISE(ABORT,'workbook_source_immutable'); END;
