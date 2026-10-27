import ExcelJS from 'exceljs';

/** Only primitive text/numbers enter cells: user input can never become a formula. */
export async function reportWorkbook(title: string, rows: (string | number | null | undefined)[][]) {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet(title, { views: [{ state: 'frozen', ySplit: 1 }] });
  sheet.addRows(rows.map(row => row.map(cell => cell ?? '')));
  sheet.getRow(1).font = { bold: true };
  sheet.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: rows[0]!.length } };
  sheet.columns.forEach(column => {
    let width = 12;
    column.eachCell!({ includeEmpty: false }, cell => { width = Math.max(width, String(cell.value ?? '').length + 2); });
    column.width = Math.min(width, 55);
    column.alignment = { vertical: 'top', wrapText: true };
  });
  return Buffer.from(await workbook.xlsx.writeBuffer());
}
