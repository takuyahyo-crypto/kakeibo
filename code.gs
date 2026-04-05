// ══════════════════════════════════════════════════
//  ふたり家計簿 — Google Apps Script API
//  このコードをすべてコピーしてApps Scriptに貼り付けてください
// ══════════════════════════════════════════════════

// スプレッドシートのシート名
const SHEET_NAME = 'transactions';

// ─── ヘッダー（列の順番） ─────────────────────────
const HEADERS = ['householdCode', 'id', 'date', 'amount', 'category', 'shop', 'payer', 'memo', 'createdAt'];

// ──────────────────────────────────────────────────
//  GET リクエスト処理（全操作をGETで行う）
// ──────────────────────────────────────────────────
function doGet(e) {
  try {
    const p      = e.parameter;
    const action = p.action || 'get';
    const code   = p.code   || '';

    if (!code && action !== 'news') return jsonRes({ error: 'codeが必要です' });

    switch (action) {
      case 'get':
        return jsonRes(getTransactions(code));

      case 'add':
        addTransaction(code, p);
        return jsonRes({ ok: true });

      case 'delete':
        deleteTransaction(code, p.id);
        return jsonRes({ ok: true });

      case 'news':
        return jsonRes(getNews());

      case 'getComments':
        return jsonRes(getComments(code));

      case 'addComment':
        return jsonRes(addComment(code, p));

      case 'deleteComment':
        return jsonRes(deleteComment(code, p.id));

      default:
        return jsonRes({ error: '不明なアクション' });
    }
  } catch (err) {
    return jsonRes({ error: err.message });
  }
}

// ──────────────────────────────────────────────────
//  取引を取得
// ──────────────────────────────────────────────────
function getTransactions(code) {
  const sheet = getSheet();
  const rows  = sheet.getDataRange().getValues();
  if (rows.length <= 1) return [];          // ヘッダーのみ

  const tz = Session.getScriptTimeZone();

  return rows.slice(1)
    .filter(row => row[0] === code)          // householdCode でフィルタ
    .map(row => ({
      id:        row[1],
      date:      toDateStr(row[2], tz),
      amount:    Number(row[3]),
      category:  row[4],
      shop:      row[5] || '',
      payer:     row[6] || '',
      memo:      row[7],
      createdAt: row[8],
    }))
    .sort((a, b) => b.date.localeCompare(a.date)); // 新しい順
}

// Date型またはシリアル値をYYYY-MM-DD文字列に変換
function toDateStr(val, tz) {
  if (val instanceof Date) {
    return Utilities.formatDate(val, tz, 'yyyy-MM-dd');
  }
  return String(val).slice(0, 10);
}

// ──────────────────────────────────────────────────
//  取引を追加
// ──────────────────────────────────────────────────
function addTransaction(code, p) {
  const sheet = getSheet();
  sheet.appendRow([
    code,
    p.id,
    p.date,
    Number(p.amount),
    p.category,
    p.shop      || '',
    p.payer     || '',
    p.memo      || '',
    p.createdAt || new Date().toISOString(),
  ]);
}

// ──────────────────────────────────────────────────
//  取引を削除
// ──────────────────────────────────────────────────
function deleteTransaction(code, id) {
  const sheet = getSheet();
  const rows  = sheet.getDataRange().getValues();

  // 後ろから検索して削除（行番号がずれないよう逆順）
  for (let i = rows.length - 1; i >= 1; i--) {
    if (rows[i][0] === code && rows[i][1] === id) {
      sheet.deleteRow(i + 1);
      break;
    }
  }
}

// ──────────────────────────────────────────────────
//  ニュース取得（NHK RSSから最新5件）
// ──────────────────────────────────────────────────
function getNews() {
  try {
    const xml  = UrlFetchApp.fetch('https://www3.nhk.or.jp/rss/news/cat0.xml').getContentText();
    const doc  = XmlService.parse(xml);
    const items = doc.getRootElement()
                     .getChild('channel')
                     .getChildren('item');
    return items.slice(0, 5).map(item => ({
      title: item.getChildText('title'),
    }));
  } catch (e) {
    return { error: e.message };
  }
}

// ──────────────────────────────────────────────────
//  共有コメント
// ──────────────────────────────────────────────────
const COMMENT_SHEET = 'comments';
const COMMENT_HEADERS = ['householdCode', 'id', 'text', 'expiry', 'createdAt'];

function getCommentSheet() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(COMMENT_SHEET);
  if (!sheet) {
    sheet = ss.insertSheet(COMMENT_SHEET);
    sheet.appendRow(COMMENT_HEADERS);
    sheet.setFrozenRows(1);
  }
  return sheet;
}

function getComments(code) {
  const sheet = getCommentSheet();
  const rows  = sheet.getDataRange().getValues();
  if (rows.length <= 1) return [];
  const today = new Date();
  today.setHours(0,0,0,0);
  return rows.slice(1)
    .filter(row => row[0] === code)
    .map(row => ({ id: row[1], text: row[2], expiry: row[3] ? String(row[3]).slice(0,10) : '', createdAt: row[4] }))
    .filter(c => !c.expiry || new Date(c.expiry + 'T23:59:59') >= today);
}

function addComment(code, p) {
  const sheet = getCommentSheet();
  sheet.appendRow([code, p.id, p.text, p.expiry || '', p.createdAt || new Date().toISOString()]);
  return { ok: true };
}

function deleteComment(code, id) {
  const sheet = getCommentSheet();
  const rows  = sheet.getDataRange().getValues();
  for (let i = rows.length - 1; i >= 1; i--) {
    if (rows[i][0] === code && rows[i][1] === id) {
      sheet.deleteRow(i + 1);
      break;
    }
  }
  return { ok: true };
}

// ──────────────────────────────────────────────────
//  シート取得（なければ作成してヘッダーを追加）
// ──────────────────────────────────────────────────
function getSheet() {
  const ss    = SpreadsheetApp.getActiveSpreadsheet();
  let   sheet = ss.getSheetByName(SHEET_NAME);
  if (!sheet) {
    sheet = ss.insertSheet(SHEET_NAME);
    sheet.appendRow(HEADERS);
    sheet.setFrozenRows(1);
  }
  return sheet;
}

// ──────────────────────────────────────────────────
//  JSONレスポンスを返す
// ──────────────────────────────────────────────────
function jsonRes(data) {
  return ContentService
    .createTextOutput(JSON.stringify(data))
    .setMimeType(ContentService.MimeType.JSON);
}
