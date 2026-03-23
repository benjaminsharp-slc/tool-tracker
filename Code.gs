// ════════════════════════════════════════════════════════════════════
//  TOOL TRACKER — Google Apps Script Backend
//  Paste this entire file into your Apps Script project and deploy
//  as a Web App (Execute as: Me, Access: Anyone)
// ════════════════════════════════════════════════════════════════════

// ── Sheet names (must match tabs in your spreadsheet exactly) ────────
const SHEET_EMPLOYEES  = 'Employees';
const SHEET_LOCATIONS  = 'Locations';
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
      case 'getLocations':       result = getLocations();                  break;
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

// ── normalizeId ────────────────────────────────────────────────────────
// Strips non-digits and returns numeric string so 1, "1", "001" all match
function normalizeId(val) {
  const n = parseInt(String(val || '').replace(/\D/g, ''), 10);
  return isNaN(n) ? String(val || '').toLowerCase().trim() : String(n);
}

// ── logRow ─────────────────────────────────────────────────────────────
// Appends a row to the log sheet and formats the ToolID cell as plain text
// so leading zeros are preserved (Sheets auto-converts "002" to 2 otherwise)
function logRow(sheet, row) {
  sheet.appendRow(row);
  const newRowNum = sheet.getLastRow();
  // ToolID is always column 2 (index 1) in the log
  sheet.getRange(newRowNum, 2).setNumberFormat('@').setValue(row[1]);
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

// ── getLocations ──────────────────────────────────────────────────────
// Reads from the Locations tab (used by admin page)
function getLocations() {
  try {
    const sheet = getSheet(SHEET_LOCATIONS);
    const data = sheet.getDataRange().getValues();
    const locs = data.slice(1)
      .map(r => String(r[0]).trim())
      .filter(Boolean);
    return { locations: locs };
  } catch(e) {
    // Fall back to deriving unique locations from Tools tab
    const sheet = getSheet(SHEET_TOOLS);
    const rows  = sheetToObjects(sheet);
    const locs  = [...new Set(rows.map(r => String(r['Home Location'] || '').trim()).filter(Boolean))].sort();
    return { locations: locs };
  }
}

// ── getToolsForCheckout ───────────────────────────────────────────────
// Returns ALL tools with status info for the checkout page
// All statuses included so the UI can show visual indicators
function getCategories() {
  const sheet = getSheet(SHEET_TOOLS);
  const rows = sheetToObjects(sheet);

  const catSet = new Set();
  const toolsByCategory = {};

  rows.forEach(r => {
    const cat    = String(r['Home Location'] || '').trim();
    const rawId  = String(r['ToolID']   || '').trim();
    const name   = String(r['Name']     || '').trim();
    if (!cat || !rawId) return;

    const id = normalizeId(rawId).padStart(3, '0');
    const status = String(r['Status'] || 'in').toLowerCase();

    // Skip permanently out-of-service tools — no point selecting them
    if (status === 'retired' || status === 'lost') return;

    catSet.add(cat);
    if (!toolsByCategory[cat]) toolsByCategory[cat] = [];
    toolsByCategory[cat].push({
      id,
      name,
      status,
      homeLocation: cat,
      checkedOutBy: String(r['CheckedOutBy'] || '').trim()
    });
  });

  return {
    locations: [...catSet].sort(),
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
      id:           (n => !isNaN(n) ? String(n).padStart(3,'0') : raw)(parseInt((String(r['ToolID']||'').trim()).replace(/\D/g,''),10)),
      name:         String(r['Name']           || '').trim(),
      homeLocation: String(r['Home Location']   || '').trim(),
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
  const toolId = String(params.toolId || '').trim();
  const toolIdNum = parseInt(toolId.replace(/\D/g, ''), 10);
  const sheet = getSheet(SHEET_TOOLS);
  const rows = sheetToObjects(sheet);

  const match = rows.find(r => {
    const existing = String(r['ToolID'] || '').trim();
    const existingNum = parseInt(existing.replace(/\D/g, ''), 10);
    // Compare numerically if both parse as numbers, otherwise string match
    if (!isNaN(toolIdNum) && !isNaN(existingNum)) return toolIdNum === existingNum;
    return existing.toUpperCase() === toolId.toUpperCase();
  });
  if (match) return { exists: true, name: match['Name'], homeLocation: match['Home Location'] };
  return { exists: false };
}

// ── addTools ──────────────────────────────────────────────────────────
// Appends new tool rows to the Tools tab
function addTools(params) {
  const tools = JSON.parse(params.tools); // [{ id, name, homeLocation }]
  const sheet = getSheet(SHEET_TOOLS);
  const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];

  const colIdx  = name => headers.indexOf(name);
  const idCol     = colIdx('ToolID');
  const nameCol   = colIdx('Name');
  const catCol    = colIdx('Home Location');
  const statusCol = colIdx('Status');

  tools.forEach(t => {
    const row = new Array(headers.length).fill('');
    row[idCol]     = t.id; // stored as string; cell formatted as text below
    row[nameCol]   = t.name;
    row[catCol]    = t.homeLocation;
    row[statusCol] = 'in';
    const newRow = sheet.getLastRow() + 1;
    sheet.appendRow(row);
    // Format the ToolID cell as plain text so leading zeros are preserved
    sheet.getRange(newRow, idCol + 1).setNumberFormat('@');
    sheet.getRange(newRow, idCol + 1).setValue(t.id);
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
  const locationCol     = colIdx('Home Location');

  toolIds.forEach(toolId => {
    for (let i = 1; i < toolData.length; i++) {
      if (String(toolData[i][idCol]).trim() === toolId) {
        const prevHolder = String(toolData[i][checkedOutByCol] || '').trim();
        const prevTime   = toolData[i][checkedOutAtCol];

        if (toolData[i][statusCol] === 'out' && prevHolder) {
          logRow(logSheet, [
            new Date(timestamp), toolId,
            toolData[i][nameCol], toolData[i][locationCol],
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

        logRow(logSheet, [
          new Date(timestamp), toolId,
          toolData[i][nameCol], toolData[i][locationCol],
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
  const locationCol     = colIdx('Home Location');
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

      logRow(logSheet, [
        new Date(timestamp), toolId,
        toolData[i][nameCol], toolData[i][locationCol],
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
      toolId:       normalizeId(r['ToolID']).padStart(3, '0'),
      toolName:     r['Name'],
      homeLocation: r['Home Location'],
      checkedOutAt: r['CheckedOutAt'] ? new Date(r['CheckedOutAt']).toISOString() : ''
    }));

  return { tools };
}

// ── historyByEmployee ──────────────────────────────────────────────────
// Returns full log history for an employee.
// "Currently out" is determined from the Tools sheet (source of truth),
// not inferred from log pairs — avoids duplicates and sync issues.
function historyByEmployee(params) {
  const employee = params.employee;

  // Get currently checked-out tools from Tools sheet (source of truth)
  const toolSheet = getSheet(SHEET_TOOLS);
  const toolRows  = sheetToObjects(toolSheet);
  const currentlyOut = new Set(
    toolRows
      .filter(r => String(r['Status']).toLowerCase() === 'out' &&
                   String(r['CheckedOutBy']).trim() === employee)
      .map(r => normalizeId(r['ToolID']))
  );

  const logSheet = getSheet(SHEET_LOG);
  const logRows  = sheetToObjects(logSheet);

  // Build a lookup of checkin events keyed by toolId+checkedOutAt
  // so we can match them to their originating checkout rows
  const checkinMap = {};
  logRows
    .filter(r => r['EventType'] === 'checkin')
    .forEach(r => {
      const key = normalizeId(r['ToolID']) + '|' + (r['CheckedOutAt'] ? new Date(r['CheckedOutAt']).toISOString() : '');
      checkinMap[key] = r['CheckedInAt'] ? new Date(r['CheckedInAt']).toISOString() : '';
    });

  // Build records from checkout rows, joining checkin time from the map
  const records = logRows
    .filter(r => String(r['Employee']).trim() === employee && r['EventType'] === 'checkout')
    .map(r => {
      const toolIdNorm   = normalizeId(r['ToolID']);
      const checkedOutAt = r['CheckedOutAt'] ? new Date(r['CheckedOutAt']).toISOString() : '';
      const key          = toolIdNorm + '|' + checkedOutAt;
      const isCurrentlyOut = currentlyOut.has(toolIdNorm);

      // For currently-out tools, checkedInAt must be blank regardless of log
      // For returned tools, pull from checkin log join
      const checkedInAt = isCurrentlyOut ? '' : (checkinMap[key] || '');

      return {
        toolId:       toolIdNorm.padStart(3, '0'),
        toolName:     r['ToolName'],
        homeLocation: r['Home Location'],
        checkedOutAt,
        checkedInAt,
        currentlyOut: isCurrentlyOut   // explicit flag for frontend filtering
      };
    });

  // Deduplicate currently-out tools: only keep the most recent checkout entry
  // (a tool could appear multiple times if checked out, returned, checked out again)
  const seenOut = new Set();
  const deduped = [];
  for (const r of records) {
    if (r.currentlyOut) {
      if (seenOut.has(r.toolId)) continue; // skip older entries for same tool
      seenOut.add(r.toolId);
    }
    deduped.push(r);
  }

  deduped.reverse();
  return { records: deduped };
}

// ── historyByTool ──────────────────────────────────────────────────────
function historyByTool(params) {
  const raw = String(params.query || '').trim();
  const queryNum = normalizeId(raw);
  const queryStr = raw.toLowerCase();

  // Get ALL matching tools from Tools sheet (not just first match)
  const toolSheet = getSheet(SHEET_TOOLS);
  const toolRows  = sheetToObjects(toolSheet);
  const matchingTools = toolRows.filter(r =>
    normalizeId(r['ToolID']) === queryNum ||
    String(r['Name']).toLowerCase().includes(queryStr)
  );

  if (!matchingTools.length) return { tools: [] };

  // Build a set of matching numeric IDs for fast log filtering
  const matchingIds = new Set(matchingTools.map(r => normalizeId(r['ToolID'])));

  const logSheet = getSheet(SHEET_LOG);
  const logRows  = sheetToObjects(logSheet);

  // Build checkin/auto-checkin lookup keyed by toolIdNorm|checkedOutAt
  const checkinMap = {};
  logRows
    .filter(r => (r['EventType'] === 'checkin' || r['EventType'] === 'auto-checkin') &&
                  matchingIds.has(normalizeId(r['ToolID'])))
    .forEach(r => {
      const key = normalizeId(r['ToolID']) + '|' + (r['CheckedOutAt'] ? new Date(r['CheckedOutAt']).toISOString() : '');
      // Don't overwrite a real checkin with an auto-checkin
      if (!checkinMap[key] || r['EventType'] === 'checkin') {
        checkinMap[key] = r['CheckedInAt'] ? new Date(r['CheckedInAt']).toISOString() : '';
      }
    });

  // Group checkout log entries by tool ID
  const recordsByTool = {};
  logRows
    .filter(r => r['EventType'] === 'checkout' && matchingIds.has(normalizeId(r['ToolID'])))
    .forEach(r => {
      const idNorm = normalizeId(r['ToolID']);
      const checkedOutAt = r['CheckedOutAt'] ? new Date(r['CheckedOutAt']).toISOString() : '';
      const key = idNorm + '|' + checkedOutAt;
      if (!recordsByTool[idNorm]) recordsByTool[idNorm] = [];
      recordsByTool[idNorm].push({
        employee:     r['Employee'],
        checkedOutAt,
        checkedInAt:  checkinMap[key] || ''
      });
    });

  // Build per-tool result objects
  const tools = matchingTools.map(t => {
    const idNorm = normalizeId(t['ToolID']);
    const records = (recordsByTool[idNorm] || []).reverse();
    return {
      toolId:           idNorm.padStart(3, '0'),
      toolName:         String(t['Name']         || ''),
      homeLocation:     String(t['Home Location'] || ''),
      currentStatus:    String(t['Status']       || 'in').toLowerCase(),
      currentCheckedOutBy: String(t['CheckedOutBy'] || '').trim(),
      records
    };
  });

  return { tools };
}

// ── fullHistory ────────────────────────────────────────────────────────
// Returns every log entry for a given tool ID or name (for admin audit tab)
function fullHistory(params) {
  const raw = String(params.query || '').trim();
  const queryNum = normalizeId(raw);
  const queryStr = raw.toLowerCase();
  const sheet = getSheet(SHEET_LOG);
  const rows = sheetToObjects(sheet);

  const records = rows
    .filter(r =>
      normalizeId(r['ToolID']) === queryNum ||
      String(r['ToolName']).toLowerCase().includes(queryStr)
    )
    .map(r => ({
      toolId:         normalizeId(r['ToolID']).padStart(3, '0'),
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
