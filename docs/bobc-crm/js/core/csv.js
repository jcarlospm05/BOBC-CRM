// Quoting alone does not prevent spreadsheet formulas in imported CSV cells.
export function csvCell(value) {
  let text = String(value ?? '');
  if (/^[\s\uFEFF]*[=+@-]/.test(text) || /^[\t\r\n]/.test(text)) text = "'" + text;
  return '"' + text.replaceAll('"', '""') + '"';
}

export function relationshipsCsv(people) {
  return '\uFEFFNombre,Tipo,Estado\r\n' + people.map(person =>
    [person.display_name, person.party_type, person.lifecycle].map(csvCell).join(',')
  ).join('\r\n');
}
