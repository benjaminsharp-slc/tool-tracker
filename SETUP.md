# Tool Tracker — Setup Guide

## Overview
The app has two parts:
1. **tool-tracker.html** — the frontend you open in a browser
2. **Code.gs** — a Google Apps Script that reads/writes your Google Sheet

---

## Step 1: Create Your Google Sheet

Create a new Google Sheet and add **4 tabs** with these exact names:

### Tab: `Employees`
| A |
|---|
| **Name** *(header)* |
| John Smith |
| Jane Doe |
| ... |

### Tab: `Categories`
*(optional reference tab — categories are driven by Tools tab)*
| A |
|---|
| **Category** |
| Power Tools |
| Hand Tools |
| Measurement |
| ... |

### Tab: `Tools`
| ToolID | Name | Category | Status | CheckedOutBy | CheckedOutAt | Condition | ConditionNotes | LastServiced | Notes |
|--------|------|----------|--------|--------------|--------------|-----------|----------------|--------------|-------|
| TOOL-001 | DeWalt Drill | Power Tools | in | | | | | | |
| TOOL-002 | Tape Measure | Measurement | in | | | | | | |

**Status** should be `in` or `out`.  
**Condition** is written automatically on check-in: `OK`, `Needs Repair`, or `Needs Replacement`.  
**ConditionNotes** stores the narrative entered by the employee at check-in.

### Tab: `CheckoutLog`
Leave this empty (just create the tab). The script writes to it automatically.

The log columns written by the script are:
`Timestamp | ToolID | ToolName | Category | Employee | CheckedOutAt | CheckedInAt | EventType | Condition | ConditionNotes`

---

## Step 2: Set Up the Apps Script

1. In your Google Sheet, click **Extensions → Apps Script**
2. Delete any existing code in the editor
3. Paste the entire contents of **Code.gs** into the editor
4. Click **Save** (Ctrl+S / Cmd+S)
5. Click **Deploy → New deployment**
6. Click the gear icon ⚙ next to "Select type" → choose **Web app**
7. Set:
   - **Description**: Tool Tracker
   - **Execute as**: Me
   - **Who has access**: Anyone *(or "Anyone within [your org]" if using Google Workspace)*
8. Click **Deploy**
9. **Copy the Web App URL** — it looks like:
   `https://script.google.com/macros/s/AKfycb.../exec`

> ⚠️ Each time you modify Code.gs, you must create a **New Deployment** (not update the existing one) for changes to take effect.

---

## Step 3: Configure the HTML File

1. Open **tool-tracker.html** in a text editor
2. Find this line near the bottom:
   ```javascript
   const APPS_SCRIPT_URL = 'YOUR_APPS_SCRIPT_URL';
   ```
3. Replace `YOUR_APPS_SCRIPT_URL` with the URL you copied in Step 2
4. Save the file

---

## Step 4: Use the App

Open **tool-tracker.html** in any browser. That's it — no server needed.

**Bookmarking tip**: Share the HTML file on a shared network drive or Google Drive so all employees can access it from their computers.

---

## Sheet Structure Notes

- **Categories** in the app are auto-populated from whatever values are in the `Category` column of the `Tools` tab. No separate maintenance needed.
- **Tool availability** is driven by the `Status` column. `in` = available, `out` = checked out.
- The `LastServiced` and `Notes` columns are reserved for future service tracking — populate them manually for now.
- To **add a tool**, just add a row to the `Tools` tab with `Status` = `in`.
- To **add an employee**, add their name to column A of the `Employees` tab.

---

## Troubleshooting

| Problem | Fix |
|---------|-----|
| "Error loading employees" | Check your Apps Script URL; make sure deployment is live |
| Categories not showing | Verify `Tools` tab has the exact column header `Category` |
| Tool shows as available but was checked out | Hard-refresh the browser (Ctrl+Shift+R) |
| Apps Script permission error | Re-deploy and accept OAuth permissions when prompted |
