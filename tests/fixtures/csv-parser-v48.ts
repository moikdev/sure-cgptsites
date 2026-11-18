// Actual parser from published version 48, commit 5addef276bbd072999381516c05b46f9a48304f5.
export function parseCSVv48(input: string, delimiter: ','|';'|'\t'|'|' = ','): string[][] {
  if(![',',';','\t','|'].includes(delimiter))throw new Error('Unsupported CSV delimiter.');
  const source = input.replace(/^\uFEFF/, "");
  const rows: string[][] = []; let row: string[] = [], field = "", quoted = false, closed = false;
  for (let i = 0; i < source.length; i++) {
    const ch = source[i];
    if (quoted) {
      if (ch === '"') { if (source[i + 1] === '"') { field += '"'; i++; } else { quoted = false; closed = true; } }
      else field += ch;
    } else if (ch === '"' && !field && !closed) quoted = true;
    else if (ch === delimiter) { row.push(field); field = ""; closed = false; }
    else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && source[i + 1] === "\n") i++;
      row.push(field); if (row.some(v => v.trim())) rows.push(row); row = []; field = ""; closed = false;
    } else { if (closed || ch === '"') throw new Error("Malformed CSV quoting."); field += ch; }
  }
  if (quoted) throw new Error("A quoted CSV field is not closed.");
  row.push(field); if (row.some(v => v.trim())) rows.push(row);
  return rows;
}
