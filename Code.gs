// ════════════════════════════════════════════════════════════════════
//  TOOL TRACKER — Google Apps Script Backend
//  Paste this entire file into your Apps Script project and deploy
//  as a Web App (Execute as: Me, Access: Anyone)
// ════════════════════════════════════════════════════════════════════

// ── Sheet names (must match tabs in your spreadsheet exactly) ────────
const SHEET_EMPLOYEES  = 'Employees';
const SHEET_CATEGORIES = 'Categories';
const SHEET_TOOLS      = 'Tools';
const SHEET_LOG        = 'CheckoutLog';

// ── Valid statuses ───────────────────────────────────────────────────
// 'in'      = available in shop
// 'out'     = checked out to employee
// 'repair'  = needs repair, not available
// 'replace' = needs replacement, not available
// 'retired' = retired / disposed
// 'lost'    = lost

// ── Main request handler ─────────────────────────────────────────────
function doGet(e) {
  const action = e.parameter.action;
  let result;

  try {
    switch (action) {
      case 'getEmployees':       result = getEmployees();                  break;
      case 'getCategories':      result = getCategories();                 break;
      case 'getCategoriesOnly':  result = getCategoriesOnly();             break;
      case 'getAllTools':        result = getAllTools();                    break;
      case 'checkToolId':        result = checkToolId(e.parameter);        break;
      case 'addTools':           result = addTools(e.parameter);           break;
      case 'setToolStatus':      result = setToolStatus(e.parameter);      break;
      case 'checkout':           result = checkout(e.parameter);           break;
      case 'checkin':            result = checkin(e.parameter);            break;
      case 'getCheckedOutTools': result = getCheckedOutTools(e.parameter); break;
      case 'historyByEmployee':  result = historyByEmployee(e.parameter);  break;
      case 'historyByTool':      result = historyByTool(e.parameter);      break;
      case 'fullHistory':        result = fullHistory(e.parameter);        break;
      default: result = { error: 'Unknown action: ' + action };
    }
  } catch(err) {
    result = { error: err.message };
  }

  return ContentService
    .createTextOutput(JSON.stringify(result))
    .setMimeType(ContentService.MimeType.JSON);
}

// ── Helpers ───────────────────────────────────────────────────────────
function getSheet(name) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(name);
  if (!sheet) throw new Error('Sheet "' + name + '" not found. Please create it.');
  return sheet;
}

function sheetToObjects(sheet, headers) {
  const data = sheet.getDataRange().getValues();
  if (data.length <= 1) return [];
  const h = headers || data[0];
  return data.slice(1).map(row => {
    const obj = {};
    h.forEach((key, i) => obj[key] = row[i] !== undefined ? row[i] : '');
    return obj;
  });
}

// ── getEmployees ───────────────────────────────────────────────────────
function getEmployees() {
  const sheet = getSheet(SHEET_EMPLOYEES);
  const data = sheet.getDataRange().getValues();
  const employees = data.slice(1)
    .map(r => String(r[0]).trim())
    .filter(Boolean);
  return { employees };
}

// ── getCategoriesOnly ─────────────────────────────────────────────────
// Reads from the Categories tab (used by admin page)
function getCategoriesOnly() {
  try {
    const sheet = getSheet(SHEET_CATEGORIES);
    const data = sheet.getDataRange().getValues();
    const cats = data.slice(1)
      .map(r => String(r[0]).trim())
      .filter(Boolean);
    return { categories: cats };
  } catch(e) {
    // Fall back to deriving from Tools tab if Categories tab is missing
    const derived = getCategories();
    return { categories: derived.categories };
  }
}

// ── getCategories + tools ──────────────────────────────────────────────
// Returns categories and tools for the checkout page
// Only 'in' status tools show as available
function getCategories() {
  const sheet = getSheet(SHEET_TOOLS);
  const rows = sheetToObjects(sheet);

  const catSet = new Set();
  const toolsByCategory = {};

  rows.forEach(r => {
    const cat  = String(r['Category'] || '').trim();
    const id   = String(r['ToolID']   || '').trim();
    const name = String(r['Name']     || '').trim();
    if (!cat || !id) return;

    catSet.add(cat);
    if (!toolsByCategory[cat]) toolsByCategory[cat] = [];
    toolsByCategory[cat].push({
      id,
      name,
      status:       String(r['Status'] || 'in').toLowerCase(),
      checkedOutBy: String(r['CheckedOutBy'] || '')
    });
  });

  return {
    categories: [...catSet].sort(),
    toolsByCategory
  };
}

// ── getAllTools ────────────────────────────────────────────────────────
// Returns all tools with full status info (for admin list page)
function getAllTools() {
  const sheet = getSheet(SHEET_TOOLS);
  const rows = sheetToObjects(sheet);

  const tools = rows
    .filter(r => String(r['ToolID'] || '').trim() !== '')
    .map(r => ({
      id:           String(r['ToolID']         || '').trim(),
      name:         String(r['Name']           || '').trim(),
      category:     String(r['Category']       || '').trim(),
      status:       String(r['Status']         || 'in').toLowerCase(),
      checkedOutBy: String(r['CheckedOutBy']   || '').trim(),
      condition:    String(r['Condition']      || '').trim(),
      notes:        String(r['ConditionNotes'] || '').trim()
    }));

  return { tools };
}

// ── checkToolId ───────────────────────────────────────────────────────
// Returns { exists, name, category } for duplicate checking
function checkToolId(params) {
  const toolId = String(params.toolId || '').trim().toUpperCase();
  const sheet = getSheet(SHEET_TOOLS);
  const rows = sheetToObjects(sheet);

  const match = rows.find(r =>
    String(r['ToolID'] || '').trim().toUpperCase() === toolId
  );
  if (match) return { exists: true, name: match['Name'], category: match['Category'] };
  return { exists: false };
}

// ── addTools ──────────────────────────────────────────────────────────
// Appends new tool rows to the Tools tab
function addTools(params) {
  const tools = JSON.parse(params.tools); // [{ id, name, category }]
  const sheet = getSheet(SHEET_TOOLS);
  const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];

  const colIdx  = name => headers.indexOf(name);
  const idCol     = colIdx('ToolID');
  const nameCol   = colIdx('Name');
  const catCol    = colIdx('Category');
  const statusCol = colIdx('Status');

  tools.forEach(t => {
    const row = new Array(headers.length).fill('');
    row[idCol]     = t.id.toUpperCase();
    row[nameCol]   = t.name;
    row[catCol]    = t.category;
    row[statusCol] = 'in';
    sheet.appendRow(row);
  });

  return { success: true, added: tools.length };
}

// ── setToolStatus ─────────────────────────────────────────────────────
// Manually sets a tool's status from the admin page
function setToolStatus(params) {
  const toolId = String(params.toolId || '').trim();
  const status = String(params.status || '').trim().toLowerCase();
  const valid  = ['in', 'out', 'repair', 'replace', 'retired', 'lost'];

  if (!valid.includes(status)) return { error: 'Invalid status: ' + status };

  const sheet = getSheet(SHEET_TOOLS);
  const data  = sheet.getDataRange().getValues();
  const headers = data[0];

  const colIdx = name => headers.indexOf(name);
  const idCol           = colIdx('ToolID');
  const statusCol       = colIdx('Status');
  const checkedOutByCol = colIdx('CheckedOutBy');
  const checkedOutAtCol = colIdx('CheckedOutAt');

  for (let i = 1; i < data.length; i++) {
    if (String(data[i][idCol]).trim() === toolId) {
      const rowNum = i + 1;
      sheet.getRange(rowNum, statusCol + 1).setValue(status);
      // Clear checkout info unless explicitly setting to 'out'
      if (status !== 'out') {
        sheet.getRange(rowNum, checkedOutByCol + 1).setValue('');
        sheet.getRange(rowNum, checkedOutAtCol + 1).setValue('');
      }
      return { success: true };
    }
  }

  return { error: 'Tool not found: ' + toolId };
}

// ── checkout ───────────────────────────────────────────────────────────
function checkout(params) {
  const employee  = params.employee;
  const toolIds   = JSON.parse(params.tools);
  const timestamp = params.timestamp || new Date().toISOString();

  const toolSheet = getSheet(SHEET_TOOLS);
  const logSheet  = getSheet(SHEET_LOG);
  const toolData  = toolSheet.getDataRange().getValues();
  const headers   = toolData[0];

  const colIdx = name => headers.indexOf(name);
  const idCol           = colIdx('ToolID');
  const statusCol       = colIdx('Status');
  const checkedOutByCol = colIdx('CheckedOutBy');
  const checkedOutAtCol = colIdx('CheckedOutAt');
  const nameCol         = colIdx('Name');
  const categoryCol     = colIdx('Category');

  toolIds.forEach(toolId => {
    for (let i = 1; i < toolData.length; i++) {
      if (String(toolData[i][idCol]).trim() === toolId) {
        const prevHolder = String(toolData[i][checkedOutByCol] || '').trim();
        const prevTime   = toolData[i][checkedOutAtCol];

        if (toolData[i][statusCol] === 'out' && prevHolder) {
          logSheet.appendRow([
            new Date(timestamp), toolId,
            toolData[i][nameCol], toolData[i][categoryCol],
            prevHolder,
            prevTime ? new Date(prevTime) : '',
            new Date(timestamp),
            'auto-checkin', '', ''
          ]);
        }

        const rowNum = i + 1;
        toolSheet.getRange(rowNum, statusCol + 1).setValue('out');
        toolSheet.getRange(rowNum, checkedOutByCol + 1).setValue(employee);
        toolSheet.getRange(rowNum, checkedOutAtCol + 1).setValue(new Date(timestamp));

        logSheet.appendRow([
          new Date(timestamp), toolId,
          toolData[i][nameCol], toolData[i][categoryCol],
          employee, new Date(timestamp), '',
          'checkout', '', ''
        ]);
        break;
      }
    }
  });

  return { success: true };
}

// ── checkin ────────────────────────────────────────────────────────────
function checkin(params) {
  const toolId         = params.toolId;
  const employee       = params.employee;
  const timestamp      = params.timestamp || new Date().toISOString();
  const needsRepair    = params.needsRepair  === 'yes';
  const needsReplace   = params.needsReplace === 'yes';
  const conditionNotes = params.conditionNotes || '';

  const toolSheet = getSheet(SHEET_TOOLS);
  const logSheet  = getSheet(SHEET_LOG);
  const toolData  = toolSheet.getDataRange().getValues();
  const headers   = toolData[0];

  const colIdx = name => headers.indexOf(name);
  const idCol           = colIdx('ToolID');
  const statusCol       = colIdx('Status');
  const checkedOutByCol = colIdx('CheckedOutBy');
  const checkedOutAtCol = colIdx('CheckedOutAt');
  const nameCol         = colIdx('Name');
  const categoryCol     = colIdx('Category');
  const conditionCol    = colIdx('Condition');
  const condNotesCol    = colIdx('ConditionNotes');

  for (let i = 1; i < toolData.length; i++) {
    if (String(toolData[i][idCol]).trim() === toolId) {
      const checkoutTime = toolData[i][checkedOutAtCol];

      // Flagged tools auto-set to out-of-circulation status
      const condition = needsReplace ? 'Needs Replacement'
                      : needsRepair  ? 'Needs Repair'
                      : 'OK';
      const newStatus = needsReplace ? 'replace'
                      : needsRepair  ? 'repair'
                      : 'in';

      logSheet.appendRow([
        new Date(timestamp), toolId,
        toolData[i][nameCol], toolData[i][categoryCol],
        employee,
        checkoutTime ? new Date(checkoutTime) : '',
        new Date(timestamp),
        'checkin', condition, conditionNotes
      ]);

      const rowNum = i + 1;
      toolSheet.getRange(rowNum, statusCol + 1).setValue(newStatus);
      toolSheet.getRange(rowNum, checkedOutByCol + 1).setValue('');
      toolSheet.getRange(rowNum, checkedOutAtCol + 1).setValue('');
      if (conditionCol >= 0) toolSheet.getRange(rowNum, conditionCol  + 1).setValue(condition);
      if (condNotesCol >= 0) toolSheet.getRange(rowNum, condNotesCol  + 1).setValue(conditionNotes);

      return { success: true, newStatus };
    }
  }

  return { error: 'Tool not found: ' + toolId };
}

// ── getCheckedOutTools ─────────────────────────────────────────────────
function getCheckedOutTools(params) {
  const employee = params.employee;
  const sheet = getSheet(SHEET_TOOLS);
  const rows = sheetToObjects(sheet);

  const tools = rows
    .filter(r => String(r['Status']).toLowerCase() === 'out' &&
                 String(r['CheckedOutBy']).trim() === employee)
    .map(r => ({
      toolId:       r['ToolID'],
      toolName:     r['Name'],
      category:     r['Category'],
      checkedOutAt: r['CheckedOutAt'] ? new Date(r['CheckedOutAt']).toISOString() : ''
    }));

  return { tools };
}

// ── historyByEmployee ──────────────────────────────────────────────────
function historyByEmployee(params) {
  const employee = params.employee;
  const sheet = getSheet(SHEET_LOG);
  const rows = sheetToObjects(sheet);

  const records = rows
    .filter(r => String(r['Employee']).trim() === employee && r['EventType'] === 'checkout')
    .map(r => ({
      toolId:       r['ToolID'],
      toolName:     r['ToolName'],
      category:     r['Category'],
      checkedOutAt: r['CheckedOutAt'] ? new Date(r['CheckedOutAt']).toISOString() : '',
      checkedInAt:  r['CheckedInAt']  ? new Date(r['CheckedInAt']).toISOString()  : ''
    }))
    .reverse();

  return { records };
}

// ── historyByTool ──────────────────────────────────────────────────────
function historyByTool(params) {
  const query = String(params.query || '').toLowerCase().trim();
  const sheet = getSheet(SHEET_LOG);
  const rows = sheetToObjects(sheet);

  const records = rows
    .filter(r => r['EventType'] === 'checkout' &&
      (String(r['ToolID']).toLowerCase().includes(query) ||
       String(r['ToolName']).toLowerCase().includes(query)))
    .map(r => ({
      toolId:       r['ToolID'],
      toolName:     r['ToolName'],
      category:     r['Category'],
      employee:     r['Employee'],
      checkedOutAt: r['CheckedOutAt'] ? new Date(r['CheckedOutAt']).toISOString() : '',
      checkedInAt:  r['CheckedInAt']  ? new Date(r['CheckedInAt']).toISOString()  : ''
    }))
    .reverse();

  return { records };
}

// ── fullHistory ────────────────────────────────────────────────────────
// Returns every log entry for a given tool ID or name (for admin audit tab)
function fullHistory(params) {
  const query = String(params.query || '').toLowerCase().trim();
  const sheet = getSheet(SHEET_LOG);
  const rows = sheetToObjects(sheet);

  const records = rows
    .filter(r =>
      String(r['ToolID']).toLowerCase().includes(query) ||
      String(r['ToolName']).toLowerCase().includes(query)
    )
    .map(r => ({
      toolId:         String(r['ToolID']         || ''),
      toolName:       String(r['ToolName']        || ''),
      eventType:      String(r['EventType']       || ''),
      employee:       String(r['Employee']        || ''),
      checkedOutAt:   r['CheckedOutAt'] ? new Date(r['CheckedOutAt']).toISOString() : '',
      checkedInAt:    r['CheckedInAt']  ? new Date(r['CheckedInAt']).toISOString()  : '',
      condition:      String(r['Condition']       || ''),
      conditionNotes: String(r['ConditionNotes']  || '')
    }))
    .reverse();

  return { records };
}
