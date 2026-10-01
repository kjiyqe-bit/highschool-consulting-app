/**
 * ===========================================================================
 * 인근 고등학교 수시 합격 데이터베이스 (상담용) - Google Apps Script 백엔드 웹앱
 * 파일: Code.gs (v24 - '학교_기본정보' A~E열 컬럼 매핑 완벽 적용)
 * ===========================================================================
 * [구글 시트 탭별 표준 구조 및 컬럼 배치]
 * 1. '학교_기본정보' (A~E열 5개 컬럼 표준):
 *    - A열: 입력한 시간 (타임스탬프, YYYY-MM-DD HH:mm:ss)
 *    - B열: 학교 코드 (예: 2026야탑고)
 *    - C열: 학생 수 (예: 350)
 *    - D열: 학교 유형 (선택값: 일반고, 자사고, 특목고 등)
 *    - E열: 교과 편성표 드라이브 링크 (URL 텍스트)
 *
 * 2. '수시합격_입력' (A~I열 9개 컬럼 표준):
 *    - A열: 입력 일시, B열: 학년도, C열: 학교명, D열: 전교 등수, E열: 합격 대학, F열: 합격 학과, G열: 전형명, H열: 내신 등급, I열: 입력자
 *
 * 3. '특별프로그램_입력' (A~F열 6개 컬럼 표준):
 *    - A열: 입력 일시, B열: 학년도, C열: 학교명, D열: 프로그램 명칭, E열: 프로그램 주요 내용, F열: 입력자
 * ===========================================================================
 */

// 1. HTTP GET 요청 처리 (웹앱에서 전체 시트 데이터를 조회할 때 호출)
function doGet(e) {
  var response = { success: true, schools: [], sushi: [], programs: [] };
  
  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    
    // (1) '학교_기본정보' 시트 데이터 읽기
    var schoolSheet = getSheetByName(ss, ["학교_기본정보", "학교_기본 정보", "학교기본정보", "학교"]);
    if (schoolSheet) {
      response.schools = getSheetDataAsObjects(schoolSheet);
    }
    
    // (2) '수시합격_입력' 시트 데이터 읽기
    var sushiSheet = getSheetByName(ss, ["수시합격_입력", "수시합격", "수시"]);
    if (sushiSheet) {
      response.sushi = getSheetDataAsObjects(sushiSheet);
    }
    
    // (3) '특별프로그램_입력' 시트 데이터 읽기
    var programSheet = getSheetByName(ss, ["특별프로그램_입력", "특별프로그램", "프로그램"]);
    if (programSheet) {
      response.programs = getSheetDataAsObjects(programSheet);
    }
    
  } catch (err) {
    response.success = false;
    response.error = err.toString();
  }
  
  return ContentService.createTextOutput(JSON.stringify(response))
    .setMimeType(ContentService.MimeType.JSON);
}

// 2. HTTP POST 요청 처리 (신규 데이터 저장)
function doPost(e) {
  var response = { success: false, message: "" };
  
  try {
    var contents = e.postData.contents;
    var data = JSON.parse(contents);
    
    var table = data.table;
    var rowData = data.data || {};
    
    // 학교 기본 정보 저장 요청 처리 ('schools' 또는 direct 매핑)
    if (table === "schools") {
      var result = saveSchoolBasicInfo(rowData);
      return ContentService.createTextOutput(JSON.stringify(result))
        .setMimeType(ContentService.MimeType.JSON);
    }
    
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var currentTimestamp = Utilities.formatDate(new Date(), "Asia/Seoul", "yyyy-MM-dd HH:mm:ss");
    
    // B. 수시 합격 데이터 저장 ('sushi')
    if (table === "sushi") {
      var sheet = getSheetByName(ss, ["수시합격_입력", "수시합격", "수시"]);
      if (!sheet) throw new Error("'수시합격_입력' 시트를 찾을 수 없습니다.");
      
      var timestamp = rowData["입력 시간"] || rowData["입력일시"] || currentTimestamp;
      var rawYear = rowData["연도"] || rowData["학년도"] || "2026";
      var year = String(rawYear).replace(/[^0-9]/g, "");

      sheet.appendRow([
        timestamp,                                         // A열: 입력 일시 (Timestamp)
        year,                                              // B열: 학년도
        rowData["학교명"] || "",                            // C열: 학교명
        rowData["전교 등수"] || rowData["전교등수"] || "",     // D열: 전교 등수
        rowData["합격 대학"] || rowData["합격대학"] || "",     // E열: 합격 대학
        rowData["합격 학과"] || rowData["합격학과"] || "",     // F열: 합격 학과
        rowData["전형명"] || "",                            // G열: 전형명
        rowData["내신 등급"] || rowData["내신등급"] || "",     // H열: 내신 등급
        rowData["입력자"] || "상담진"                        // I열: 입력자
      ]);
      
      response.success = true;
      response.message = "수시 합격 데이터가 성공적으로 등록되었습니다.";
      
    // C. 특별 프로그램 데이터 저장 ('programs')
    } else if (table === "programs") {
      var sheet = getSheetByName(ss, ["특별프로그램_입력", "특별프로그램", "프로그램"]);
      if (!sheet) throw new Error("'특별프로그램_입력' 시트를 찾을 수 없습니다.");
      
      var timestamp = rowData["입력 시간"] || rowData["입력일시"] || currentTimestamp;
      var rawYear = rowData["연도"] || rowData["학년도"] || "2026";
      var year = String(rawYear).replace(/[^0-9]/g, "");

      sheet.appendRow([
        timestamp,                                         // A열: 입력 일시 (Timestamp)
        year,                                              // B열: 학년도
        rowData["학교명"] || "",                            // C열: 학교명
        rowData["프로그램 명칭"] || "",                      // D열: 프로그램 명칭
        rowData["프로그램 주요 내용"] || "",                  // E열: 주요 내용
        rowData["입력자"] || "상담진"                        // F열: 입력자
      ]);
      
      response.success = true;
      response.message = "특별 프로그램 데이터가 성공적으로 등록되었습니다.";
    }
    
  } catch (err) {
    response.success = false;
    response.error = err.toString();
  }
  
  return ContentService.createTextOutput(JSON.stringify(response))
    .setMimeType(ContentService.MimeType.JSON);
}

/**
 * 3. '학교_기본정보' 전용 저장 함수 (google.script.run 및 doPost 호환)
 * A열: 입력시간 (타임스탬프)
 * B열: 학교코드 (자동 생성/매핑)
 * C열: 학생수
 * D열: 학교유형
 * E열: 교과편성표 드라이브 링크
 */
function saveSchoolBasicInfo(data) {
  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var sheet = getSheetByName(ss, ["학교_기본정보", "학교_기본 정보", "학교기본정보", "학교"]);
    if (!sheet) {
      throw new Error("'학교_기본정보' 시트를 찾을 수 없습니다.");
    }
    
    // A열: 타임스탬프 (YYYY-MM-DD HH:mm:ss)
    var timestamp = data["입력 시간"] || data["입력시간"] || data["입력일시"] || Utilities.formatDate(new Date(), "Asia/Seoul", "yyyy-MM-dd HH:mm:ss");
    
    // 학교명 및 학년도 기반 학교 코드 자동 생성
    var name = data["학교명"] || "";
    var rawYear = data["학년도"] || data["연도"] || "2026";
    var yearNum = String(rawYear).replace(/[^0-9]/g, "");
    var prefix = name.length >= 4 ? name.substring(0, 4) : name;
    
    // B열: 학교 코드
    var schoolCode = data["학교 코드"] || data["학교코드"] || data["학교 코드(고유값)"] || data["학교코드(고유값)"] || (yearNum + prefix);
    
    // C열: 학생 수
    var students = data["학생 수"] || data["학생수"] || data["전교 학생수"] || data["전교학생수"] || data["studentCount"] || "";
    
    // D열: 학교 유형
    var schoolType = data["학교 유형"] || data["학교유형"] || data["유형"] || "일반고";
    
    // E열: 교과 편성표 드라이브 링크
    var link = data["교과 편성표"] || data["교과편성표"] || data["교과 편성표(링크)"] || data["드라이브링크"] || data["링크"] || "";

    var lastCol = sheet.getLastColumn();
    var newRow = [];

    // 시트에 1행 헤더가 명시되어 있을 경우 헤더 위치에 정확히 대응
    if (lastCol >= 5) {
      var headers = sheet.getRange(1, 1, 1, lastCol).getValues()[0];
      var hasMatchedHeaders = false;
      
      for (var i = 0; i < headers.length; i++) {
        var h = String(headers[i]).trim();
        if (h.indexOf("입력") !== -1 || h.indexOf("시간") !== -1) { newRow.push(timestamp); hasMatchedHeaders = true; }
        else if (h.indexOf("코드") !== -1) { newRow.push(schoolCode); hasMatchedHeaders = true; }
        else if (h.indexOf("학생") !== -1) { newRow.push(students); hasMatchedHeaders = true; }
        else if (h.indexOf("유형") !== -1) { newRow.push(schoolType); hasMatchedHeaders = true; }
        else if (h.indexOf("편성") !== -1 || h.indexOf("링크") !== -1 || h.indexOf("드라이브") !== -1) { newRow.push(link); hasMatchedHeaders = true; }
        else if (h.indexOf("학년") !== -1 || h.indexOf("연도") !== -1) { newRow.push(yearNum); }
        else if (h.indexOf("학교명") !== -1) { newRow.push(name); }
        else { newRow.push(data[h] || ""); }
      }

      if (!hasMatchedHeaders) {
        // 헤더 매핑 미일치 시 A~E열 표준 순서 기록
        newRow = [timestamp, schoolCode, students, schoolType, link];
      }
    } else {
      // 기본 A~E열 5개 컬럼 순서 고정 저장 (A:입력시간, B:학교코드, C:학생수, D:학교유형, E:드라이브링크)
      newRow = [timestamp, schoolCode, students, schoolType, link];
    }
    
    sheet.appendRow(newRow);

    return {
      success: true,
      message: "'" + name + "' 학교 기본 정보가 성공적으로 구글 시트(A~E열)에 저장되었습니다.",
      data: newRow
    };
  } catch (err) {
    return {
      success: false,
      error: err.toString()
    };
  }
}

// 헬퍼 1: 시트 데이터를 JSON 객체 배열로 반환
function getSheetDataAsObjects(sheet) {
  var lastRow = sheet.getLastRow();
  var lastCol = sheet.getLastColumn();
  if (lastRow <= 1 || lastCol === 0) return [];
  
  var data = sheet.getRange(1, 1, lastRow, lastCol).getValues();
  var headers = data[0];
  var result = [];
  
  for (var r = 1; r < data.length; r++) {
    var row = data[r];
    var obj = {};
    for (var c = 0; c < headers.length; c++) {
      var headerName = String(headers[c]).trim();
      if (headerName !== "") {
        obj[headerName] = row[c];
      }
    }
    result.push(obj);
  }
  return result;
}

// 헬퍼 2: 여러 후보 이름 중 실제로 존재하는 시트 반환
function getSheetByName(ss, nameCandidates) {
  for (var i = 0; i < nameCandidates.length; i++) {
    var sheet = ss.getSheetByName(nameCandidates[i]);
    if (sheet) return sheet;
  }
  return null;
}
