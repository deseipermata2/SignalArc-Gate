/** Explicit boundaries allow reviewed trigger bodies without pretending to parse arbitrary SQL. */
export function migrationStatements(sql) {
  const parts = /^-- signalarc:statement\r?$/m.test(sql)
    ? sql.split(/^-- signalarc:statement\r?$/m)
    : sql.split(';')
  return parts.map((part) => part.trim()).filter(Boolean)
}
