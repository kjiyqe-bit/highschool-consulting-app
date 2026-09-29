/**
 * ===================================================================
 * 고교 수시 상담센터 - Google Apps Script (GAS) 통합 웹훅 스크립트 (v1)
 * ===================================================================
 * 1. doGet: 구글 시트 5개 탭 실시간 JSON 데이터 반환
 * 2. doPost: 학교 기본정보, 수시합격, 특별프로그램 등록 및 구글드라이브 업로드
 * ===================================================================
 */

function doGet(e) {
  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var result = {
      success: true,
      status: "online",
      time: Utilities.formatDate(new Date(), "Asia/Seoul", "yyyy-MM-dd HH:mm:ss")
    };

    var sheets = ["접근 권한", "학교_기본정보", "수시합격_입력", "특별프로그램_입력", "대시보드_집계용"];
    sheets.forEach(function(name) {
      var sheet = ss.getSheetByName(name);
      if (sheet) {
        result[name] = getSheetDataAsJson(sheet);
      }
    });

    return ContentService.createTextOutput(JSON.stringify(result))
      .setMimeType(ContentService.MimeType.JSON);
  } catch (err) {
    return ContentService.createTextOutput(JSON.stringify({
      success: false,
      error: err.toString()
    })).setMimeType(ContentService.MimeType.JSON);
  }
}

function doPost(e) {
  var lock = LockService.getScriptLock();
  try {
    lock.waitLock(20000);

    var reqData = {};
    if (e.postData && e.postData.contents) {
      reqData = JSON.parse(e.postData.contents);
    } else if (e.parameter) {
      reqData = e.parameter;
    }

    var action = reqData.action || "add";
    var table = reqData.table || "schools";
    var data = reqData.data || {};

    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var sheetName = "";

    if (table === "schools" || table === "학교_기본정보" || table === "학교") {
      sheetName = "학교_기본정보";
    } else if (table === "sushi" || table === "수시합격_입력" || table === "수시") {
      sheetName = "수시합격_입력";
    } else if (table === "programs" || table === "특별프로그램_입력" || table === "프로그램") {
      sheetName = "특별프로그램_입력";
    }

    var sheet = ss.getSheetByName(sheetName);
    if (!sheet) {
      return ContentService.createTextOutput(JSON.stringify({
        success: false,
        error: "시트를 찾을 수 없습니다: " + sheetName
      })).setMimeType(ContentService.MimeType.JSON);
    }

    if (action === "add" || action === "insert") {
      var newRow = [];
      var now = Utilities.formatDate(new Date(), "Asia/Seoul", "yyyy. M. d a h:mm:ss");

      if (sheetName === "학교_기본정보") {
        var yearVal = String(data["연도"] || 2026);
        var schoolName = String(data["학교명"] || "");
        var schoolCode = data["학교코드(고유값)"] || (yearVal + schoolName.substring(0, 4));
        var students = String(data["전교 학생수"] || data["전교학생수"] || "");
        var link = data["교과 편성표(링크)"] || data["링크"] || "링크입력예정";
        var progress = data["데이터 수집 현황"] || "0 / 10";

        newRow = [schoolCode, yearVal, schoolName, students, link, progress];
      } else if (sheetName === "수시합격_입력") {
        newRow = [
          now,
          data["연도"] || 2026,
          data["학교명"] || "",
          data["전교 등수"] || "",
          data["합격 대학"] || "",
          data["합격 학과"] || "",
          data["전형명"] || "",
          data["내신 등급"] || "",
          data["입력자"] || ""
        ];
      } else if (sheetName === "특별프로그램_입력") {
        newRow = [
          now,
          data["연도"] || 2026,
          data["학교명"] || "",
          data["프로그램 명칭"] || data["프로그램명"] || "",
          data["프로그램 주요 내용"] || data["프로그램 내용"] || "",
          data["입력자"] || ""
        ];
      }

      sheet.appendRow(newRow);

      return ContentService.createTextOutput(JSON.stringify({
        success: true,
        message: "구글 시트에 성공적으로 추가되었습니다.",
        row: newRow
      })).setMimeType(ContentService.MimeType.JSON);
    }

    return ContentService.createTextOutput(JSON.stringify({
      success: true,
      message: "작업 완료"
    })).setMimeType(ContentService.MimeType.JSON);

  } catch (err) {
    return ContentService.createTextOutput(JSON.stringify({
      success: false,
      error: err.toString()
    })).setMimeType(ContentService.MimeType.JSON);
  } finally {
    lock.releaseLock();
  }
}

function getSheetDataAsJson(sheet) {
  var values = sheet.getDataRange().getValues();
  if (values.length < 2) return [];

  var headers = values[0].map(function(h) { return String(h).trim(); });
  var rows = [];

  for (var i = 1; i < values.length; i++) {
    var row = values[i];
    var obj = { _row: i + 1 };
    var hasData = false;

    for (var j = 0; j < headers.length; j++) {
      var header = headers[j];
      if (header) {
        var val = row[j];
        if (val instanceof Date) {
          val = Utilities.formatDate(val, "Asia/Seoul", "yyyy-MM-dd HH:mm:ss");
        }
        obj[header] = val;
        if (val !== "" && val !== null && val !== undefined) {
          hasData = true;
        }
      }
    }
    if (hasData) rows.push(obj);
  }
  return rows;
}
