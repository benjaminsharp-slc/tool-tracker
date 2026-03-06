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

// ── Main request handler ─────────────────────────────────────────────
function doGet(e) {
  const action = e.parameter.action;
  let result;

  try {
    switch (action) {
      case 'getEmployees':      result = getEmployees();             break;
      case 'getCategories':     result = getCategories();            break;
      case 'checkout':          result = checkout(e.parameter);      break;
      case 'checkin':           result = checkin(e.parameter);       break;
      case 'getCheckedOutTools':result = getCheckedOutTools(e.parameter); break;
      case 'historyByEmployee': result = historyByEmployee(e.parameter); break;
      case 'historyByTool':     result = historyByTool(e.parameter); break;
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
  // Column A: employee names (skip header row)
  const employees = data.slice(1)
    .map(r => String(r[0]).trim())
    .filter(Boolean);
  return { employees };
}

// ── getCategories + tools ──────────────────────────────────────────────
//  Returns categories list and a toolsByCategory map of available tools
function getCategories() {
  const sheet = getSheet(SHEET_TOOLS);
  const rows = sheetToObjects(sheet);
  // Expected columns: ToolID, Name, Category, Status, CheckedOutBy, CheckedOutAt, LastServiced, Notes

  const catSet = new Set();
  const toolsByCategory = {};

  rows.forEach(r => {
    const cat = String(r['Category'] || '').trim();
    const id  = String(r['ToolID']   || '').trim();
    const name= String(r['Name']     || '').trim();
    if (!cat || !id) return;

    catSet.add(cat);
    if (!toolsByCategory[cat]) toolsByCategory[cat] = [];
    toolsByCategory[cat].push({
      id,
      name,
      status:       String(r['Status']       || 'in').toLowerCase(),
      checkedOutBy: String(r['CheckedOutBy'] || '')
    });
  });

  return {
    categories: [...catSet].sort(),
    toolsByCategory
  };
}

// ── checkout ───────────────────────────────────────────────────────────
function checkout(params) {
  const employee  = params.employee;
  const toolIds   = JSON.parse(params.tools);   // array of ToolIDs
  const timestamp = params.timestamp || new Date().toISOString();

  const toolSheet = getSheet(SHEET_TOOLS);
  const logSheet  = getSheet(SHEET_LOG);
  const toolData  = toolSheet.getDataRange().getValues();
  const headers   = toolData[0];

  const colIdx = name => headers.indexOf(name);
  const idCol         = colIdx('ToolID');
  const statusCol     = colIdx('Status');
  const checkedOutByCol = colIdx('CheckedOutBy');
  const checkedOutAtCol = colIdx('CheckedOutAt');
  const nameCol       = colIdx('Name');
  const categoryCol   = colIdx('Category');

  toolIds.forEach(toolId => {
    for (let i = 1; i < toolData.length; i++) {
      if (String(toolData[i][idCol]).trim() === toolId) {
        const prevHolder = String(toolData[i][checkedOutByCol] || '').trim();
        const prevTime   = toolData[i][checkedOutAtCol];

        // If currently out, auto-check-in for previous holder
        if (toolData[i][statusCol] === 'out' && prevHolder) {
          logSheet.appendRow([
            new Date(timestamp),
            toolId,
            toolData[i][nameCol],
            toolData[i][categoryCol],
            prevHolder,
            prevTime ? new Date(prevTime) : '',
            new Date(timestamp),
            'auto-checkin'
          ]);
        }

        // Update tool row
        const rowNum = i + 1;
        toolSheet.getRange(rowNum, statusCol + 1).setValue('out');
        toolSheet.getRange(rowNum, checkedOutByCol + 1).setValue(employee);
        toolSheet.getRange(rowNum, checkedOutAtCol + 1).setValue(new Date(timestamp));

        // Log the checkout
        logSheet.appendRow([
          new Date(timestamp),
          toolId,
          toolData[i][nameCol],
          toolData[i][categoryCol],
          employee,
          new Date(timestamp),
          '',
          'checkout'
        ]);
        break;
      }
    }
  });

  return { success: true };
}

// ── checkin ────────────────────────────────────────────────────────────
function checkin(params) {
  const toolId        = params.toolId;
  const employee      = params.employee;
  const timestamp     = params.timestamp || new Date().toISOString();
  const needsRepair   = params.needsRepair  === 'yes';
  const needsReplace  = params.needsReplace === 'yes';
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
  const conditionCol    = colIdx('Condition');   // "OK", "Needs Repair", "Needs Replacement"
  const condNotesCol    = colIdx('ConditionNotes');

  for (let i = 1; i < toolData.length; i++) {
    if (String(toolData[i][idCol]).trim() === toolId) {
      const checkoutTime = toolData[i][checkedOutAtCol];
      const condition    = needsReplace ? 'Needs Replacement' : needsRepair ? 'Needs Repair' : 'OK';

      // Log the checkin
      logSheet.appendRow([
        new Date(timestamp),
        toolId,
        toolData[i][nameCol],
        toolData[i][categoryCol],
        employee,
        checkoutTime ? new Date(checkoutTime) : '',
        new Date(timestamp),
        'checkin',
        condition,
        conditionNotes
      ]);

      // Update tool row
      const rowNum = i + 1;
      toolSheet.getRange(rowNum, statusCol + 1).setValue('in');
      toolSheet.getRange(rowNum, checkedOutByCol + 1).setValue('');
      toolSheet.getRange(rowNum, checkedOutAtCol + 1).setValue('');
      if (conditionCol >= 0)  toolSheet.getRange(rowNum, conditionCol + 1).setValue(condition);
      if (condNotesCol >= 0)  toolSheet.getRange(rowNum, condNotesCol + 1).setValue(conditionNotes);

      return { success: true };
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
      toolId:      r['ToolID'],
      toolName:    r['Name'],
      category:    r['Category'],
      checkedOutAt: r['CheckedOutAt'] ? new Date(r['CheckedOutAt']).toISOString() : ''
    }));

  return { tools };
}

// ── historyByEmployee ──────────────────────────────────────────────────
function historyByEmployee(params) {
  const employee = params.employee;
  const sheet = getSheet(SHEET_LOG);
  const rows = sheetToObjects(sheet, ['Timestamp','ToolID','ToolName','Category','Employee','CheckedOutAt','CheckedInAt','EventType']);

  const records = rows
    .filter(r => String(r['Employee']).trim() === employee && r['EventType'] === 'checkout')
    .map(r => ({
      toolId:      r['ToolID'],
      toolName:    r['ToolName'],
      category:    r['Category'],
      checkedOutAt: r['CheckedOutAt'] ? new Date(r['CheckedOutAt']).toISOString() : '',
      checkedInAt:  r['CheckedInAt']  ? new Date(r['CheckedInAt']).toISOString()  : ''
    }))
    .reverse(); // most recent first

  return { records };
}

// ── historyByTool ──────────────────────────────────────────────────────
function historyByTool(params) {
  const query = String(params.query || '').toLowerCase().trim();
  const sheet = getSheet(SHEET_LOG);
  const rows = sheetToObjects(sheet, ['Timestamp','ToolID','ToolName','Category','Employee','CheckedOutAt','CheckedInAt','EventType']);

  const records = rows
    .filter(r => r['EventType'] === 'checkout' &&
      (String(r['ToolID']).toLowerCase().includes(query) ||
       String(r['ToolName']).toLowerCase().includes(query)))
    .map(r => ({
      toolId:      r['ToolID'],
      toolName:    r['ToolName'],
      category:    r['Category'],
      employee:    r['Employee'],
      checkedOutAt: r['CheckedOutAt'] ? new Date(r['CheckedOutAt']).toISOString() : '',
      checkedInAt:  r['CheckedInAt']  ? new Date(r['CheckedInAt']).toISOString()  : ''
    }))
    .reverse();

  return { records };
}
