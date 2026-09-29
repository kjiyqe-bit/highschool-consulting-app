/**
 * ====================================================================
 * 구글 스프레드시트 및 구글 드라이브 폴더 양방향 연동 Google Apps Script (v4)
 * --------------------------------------------------------------------
 * [추가 기능]
 * 1. 구글 드라이브 폴더(1VV99M5R7i0392maHg3qyK5GYodGoNnrf) 내 파일 중복 확인 (action: "check_file")
 * 2. 중복 파일 삭제 후 업로드 (action: "upload_file", overwrite: true 시 기존 파일 Trash로 이동)
 * 3. '학교_기본정보' 시트에 신규 이력 로그 행 누적 appendRow
 * ====================================================================
 */

var TARGET_DRIVE_FOLDER_ID = "1VV99M5R7i0392maHg3qyK5GYodGoNnrf";

function doPost(e) {
  var lock = LockService.getScriptLock();
  lock.waitLock(20000);

  try {
    var requestData = JSON.parse(e.postData.contents);
    var action = requestData.action; // "add", "update", "delete", "upload_file", "check_file"
    var table = requestData.table;   // "schools", "sushi", "programs"
    var data = requestData.data;

    // -----------------------------------------------------------------
    // 0-1. [구글 드라이브 폴더 파일 중복 확인]
    // -----------------------------------------------------------------
    if (action === "check_file") {
      var folderId = data.folder_id || TARGET_DRIVE_FOLDER_ID;
      var folder = DriveApp.getFolderById(folderId);
      var fileName = data.file_name;
      var files = folder.getFilesByName(fileName);

      if (files.hasNext()) {
        var existingFile = files.next();
        return ContentService.createTextOutput(JSON.stringify({
          "success": true,
          "exists": true,
          "file_id": existingFile.getId(),
          "file_url": existingFile.getUrl(),
          "file_name": fileName
        })).setMimeType(ContentService.MimeType.JSON);
      } else {
        return ContentService.createTextOutput(JSON.stringify({
          "success": true,
          "exists": false,
          "file_name": fileName
        })).setMimeType(ContentService.MimeType.JSON);
      }
    }

    // -----------------------------------------------------------------
    // 0-2. [구글 드라이브 폴더 파일 업로드 (중복 시 삭제 후 생성)]
    // -----------------------------------------------------------------
    if (action === "upload_file") {
      var folderId = data.folder_id || TARGET_DRIVE_FOLDER_ID;
      var folder = DriveApp.getFolderById(folderId);
      var fileName = data.file_name || "curriculum.pdf";
      var mimeType = data.mime_type || "application/pdf";
      var overwrite = data.overwrite || false;

      // overwrite=true인 경우 동일 이름의 기존 파일들을 모두 휴지통으로 이동
      if (overwrite) {
        var existingFiles = folder.getFilesByName(fileName);
        while (existingFiles.hasNext()) {
          var oldFile = existingFiles.next();
          oldFile.setTrashed(true);
        }
      }

      var fileBytes = Utilities.base64Decode(data.file_base64);
      var blob = Utilities.newBlob(fileBytes, mimeType, fileName);
      var createdFile = folder.createFile(blob);
      createdFile.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
      var fileUrl = createdFile.getUrl();

      return ContentService.createTextOutput(JSON.stringify({
        "success": true,
        "file_url": fileUrl,
        "file_id": createdFile.getId(),
        "file_name": fileName,
        "message": "구글 드라이브 폴더에 성공적으로 저장되었습니다."
      })).setMimeType(ContentService.MimeType.JSON);
    }

    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var sheetName = "";

    if (table === "schools" || table === "학교_기본정보" || table === "학교") {
      sheetName = "학교_기본정보";
    } else if (table === "sushi" || table === "수시합격_입력" || table === "수시") {
      sheetName = "수시합격_입력";
    } else if (table === "programs" || table === "특별프로그램_입력" || table === "프로그램") {
      sheetName = "특별프로그램_입력";
    } else {
      return ContentService.createTextOutput(JSON.stringify({
        "success": false,
        "error": "해당 시트는 보안상 수정할 수 없습니다: " + table
      })).setMimeType(ContentService.MimeType.JSON);
    }

    var sheet = ss.getSheetByName(sheetName);
    if (!sheet) {
      return ContentService.createTextOutput(JSON.stringify({
        "success": false,
        "error": "시트를 찾을 수 없습니다: " + sheetName
      })).setMimeType(ContentService.MimeType.JSON);
    }

    // -----------------------------------------------------------------
    // 1. [신규 추가 및 이력 로그 누적 (appendRow)]
    // -----------------------------------------------------------------
    if (action === "add" || action === "insert") {
      var newRow = [];
      var now = Utilities.formatDate(new Date(), "Asia/Seoul", "yyyy. M. d a h:mm:ss");

      // 1) 학교 기본 정보 등록
      // - A열: 학교코드(고유값)
      // - B열: 연도
      // - C열: 학교명
      // - D열: 전교 학생수
      // - E열: 링크 (교과 편성표 링크)
      // - F열: 데이터 수집 현황
      if (sheetName === "학교_기본정보") {
        var yearVal = String(data["연도"] || 2026);
        var schoolName = String(data["학교명"] || "");
        var schoolCode = data["학교코드(고유값)"] || (yearVal + schoolName.substring(0, 4));
        var students = String(data["전교 학생수"] || data["전교학생수"] || "");
        var link = data["교과 편성표(링크)"] || data["링크"] || data["교과 편성표"] || "링크입력예정";
        var progress = data["데이터 수집 현황"] || "0 / 10";

        newRow = [
          schoolCode, // A열
          yearVal,    // B열: 연도
          schoolName, // C열: 학교명
          students,   // D열: 전교 학생수
          link,       // E열: 링크
          progress    // F열: 데이터 수집 현황
        ];
      } 
      // 2) 수시 합격 데이터 등록
      else if (sheetName === "수시합격_입력") {
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
      } 
      // 3) 특별 프로그램 등록
      // - D열: 프로그램 명칭
      // - E열: 프로그램 주요 내용
      else if (sheetName === "특별프로그램_입력") {
        var progTitle = data["프로그램 명칭"] || data["프로그램명"] || "";
        var progContent = data["프로그램 주요 내용"] || data["프로그램 내용"] || data["프로그램주요내용"] || data["주요 내용"] || "";
        newRow = [
          now,
          data["연도"] || 2026,
          data["학교명"] || "",
          progTitle,   // D열: 프로그램 명칭
          progContent, // E열: 프로그램 내용
          data["입력자"] || ""
        ];
      }

      sheet.appendRow(newRow);
      return ContentService.createTextOutput(JSON.stringify({
        "success": true,
        "message": "시트에 성공적으로 추가되었습니다.",
        "row": newRow
      })).setMimeType(ContentService.MimeType.JSON);
    }

    // -----------------------------------------------------------------
    // 2. [수정 및 삭제 로직]
    // -----------------------------------------------------------------
    var lastRow = sheet.getLastRow();
    if (lastRow > 1) {
      var range = sheet.getRange(2, 1, lastRow - 1, sheet.getLastColumn());
      var values = range.getValues();

      for (var i = 0; i < values.length; i++) {
        var row = values[i];
        var rowMatched = false;

        if (table === "schools") {
          if (String(row[0]) == String(data["학교코드(고유값)"])) {
            rowMatched = true;
          }
        } else if (table === "sushi") {
          if (String(row[1]) == String(data["연도"]) &&
              String(row[2]) == String(data["학교명"]) &&
              String(row[3]) == String(data["전교 등수"])) {
            rowMatched = true;
          }
        } else if (table === "programs") {
          if (String(row[1]) == String(data["연도"]) &&
              String(row[2]) == String(data["학교명"]) &&
              String(row[3]) == String(data["프로그램 명칭"])) {
            rowMatched = true;
          }
        }

        if (rowMatched) {
          var rowIndex = i + 2;
          if (action === "delete") {
            sheet.deleteRow(rowIndex);
            return ContentService.createTextOutput(JSON.stringify({
              "success": true,
              "message": "행이 삭제되었습니다."
            })).setMimeType(ContentService.MimeType.JSON);
          } else if (action === "update") {
            if (table === "schools") {
              var y = String(data["연도"] || row[1]);
              var sName = String(data["학교명"] || row[2]);
              var sCode = y + sName.substring(0, 4);

              sheet.getRange(rowIndex, 1).setValue(sCode);
              sheet.getRange(rowIndex, 2).setValue(y);
              sheet.getRange(rowIndex, 3).setValue(sName);
              sheet.getRange(rowIndex, 4).setValue(String(data["전교 학생수"] || row[3]));
              if (data["교과 편성표(링크)"]) {
                sheet.getRange(rowIndex, 5).setValue(data["교과 편성표(링크)"]);
              }
            } else if (table === "sushi") {
              sheet.getRange(rowIndex, 4).setValue(data["전교 등수"] || "");
              sheet.getRange(rowIndex, 5).setValue(data["합격 대학"] || "");
              sheet.getRange(rowIndex, 6).setValue(data["합격 학과"] || "");
              sheet.getRange(rowIndex, 7).setValue(data["전형명"] || "");
              sheet.getRange(rowIndex, 8).setValue(data["내신 등급"] || "");
              sheet.getRange(rowIndex, 9).setValue(data["입력자"] || "");
            } else if (table === "programs") {
              sheet.getRange(rowIndex, 4).setValue(data["프로그램 명칭"] || "");
              sheet.getRange(rowIndex, 5).setValue(data["프로그램 주요 내용"] || "");
              sheet.getRange(rowIndex, 6).setValue(data["입력자"] || "");
            }
            return ContentService.createTextOutput(JSON.stringify({
              "success": true,
              "message": "행이 수정되었습니다."
            })).setMimeType(ContentService.MimeType.JSON);
          }
        }
      }
    }

    return ContentService.createTextOutput(JSON.stringify({
      "success": true,
      "message": "처리가 완료되었습니다."
    })).setMimeType(ContentService.MimeType.JSON);

  } catch (error) {
    return ContentService.createTextOutput(JSON.stringify({
      "success": false,
      "error": error.toString()
    })).setMimeType(ContentService.MimeType.JSON);
  } finally {
    lock.releaseLock();
  }
}

function doGet(e) {
  return ContentService.createTextOutput(JSON.stringify({
    "status": "online",
    "version": "v4",
    "drive_folder_id": TARGET_DRIVE_FOLDER_ID,
    "service": "HighSchool Consulting API Webhook"
  })).setMimeType(ContentService.MimeType.JSON);
}
