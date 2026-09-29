const SHEETS_BASE = 'https://sheets.googleapis.com/v4/spreadsheets';

async function parseResponse(response, fallback) {
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error?.message || `${fallback} (${response.status})`);
  return data;
}

function objectToRow(object, headers) {
  return headers.map((header) => object[header] ?? '');
}

async function appendRow(accessToken, spreadsheetId, sheetName, object, headers) {
  const range = `${sheetName}!A:Z`;
  const url = `${SHEETS_BASE}/${encodeURIComponent(spreadsheetId)}/values/${encodeURIComponent(range)}:append?valueInputOption=USER_ENTERED`;
  const response = await fetch(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ values: [objectToRow(object, headers)] }),
  });
  return parseResponse(response, `Không ghi được vào sheet ${sheetName}`);
}
