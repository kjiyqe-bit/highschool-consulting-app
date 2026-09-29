/**
 * ===========================================================================
 * 인근 고등학교 수시 합격 데이터베이스 (상담용) - Google Apps Script 백엔드 웹앱
 * 파일: Code.gs (v22 - 학교 유형, 학생 수 완전 호환 및 doGet 데이터 반환 지원)
 * ===========================================================================
 * [구글 시트 탭별 표준 구조 및 컬럼 배치]
 * 1. '학교_기본 정보': A열 입력 일시, B열 학교 코드(고유값), C열 학년도, D열 학교명, E열 학생 수, F열 학교 유형, G열 교과 편성표(링크)
 * 2. '수시합격_입력': A열 입력 일시, B열 학년도, C열 학교명, D열 전교 등수, E열 합격 대학, F열 합격 학과, G열 전형명, H열 내신 등급, I열 입력자
 * 3. '특별프로그램_입력': A열 입력 일시, B열 학년도, C열 학교명, D열 프로그램 명칭, E열 프로그램 주요 내용, F열 입력자
 * ===========================================================================
 */

// 1. HTTP GET 요청 처리 (시트 데이터 조회)
function doGet(e) {
  var response = { success: true, schools: [], sushi: [], programs: [] };
  
  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    
    // (1) 학교_기본 정보 읽기
    var schoolSheet = getSheetByName(ss, ["학교_기본 정보", "학교_기본정보", "학교기본정보", "학교"]);
    if (schoolSheet) {
      response.schools = getSheetDataAsObjects(schoolSheet);
    }
    
    // (2) 수시합격_입력 읽기
    var sushiSheet = getSheetByName(ss, ["수시합격_입력", "수시합격", "수시"]);
    if (sushiSheet) {
      response.sushi = getSheetDataAsObjects(sushiSheet);
    }
    
    // (3) 특별프로그램_입력 읽기
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

// 2. HTTP POST 요청 처리 (신규 데이터 입력/저장)
function doPost(e) {
  var response = { success: false, message: "" };
  
  try {
    var contents = e.postData.contents;
    var data = JSON.parse(contents);
    
    var table = data.table;
    var rowData = data.data || {};
    
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    
    // 한국 표준시 (Asia/Seoul) 타임스탬프 생성
    var currentTimestamp = Utilities.formatDate(new Date(), "Asia/Seoul", "yyyy-MM-dd HH:mm:ss");
    
    // -----------------------------------------------------------------------
    // A. 학교 기본 정보 등록 ('schools')
    // -----------------------------------------------------------------------
    if (table === "schools") {
      var sheet = getSheetByName(ss, ["학교_기본 정보", "학교_기본정보", "학교기본정보", "학교"]);
      if (!sheet) throw new Error("'학교_기본 정보' 시트를 찾을 수 없습니다.");
      
      var timestamp = rowData["입력 시간"] || rowData["입력일시"] || currentTimestamp;
      var rawYear = rowData["학년도"] || rowData["연도"] || "2026";
      var year = String(rawYear).replace(/[^0-9]/g, "");
      var name = rowData["학교명"] || "";
      // 학생 수 다양한 헤더 명칭 호환 체크
      var students = rowData["학생 수"] || rowData["학생수"] || rowData["전교 학생수"] || rowData["전교학생수"] || rowData["studentCount"] || "";
      // 학교 유형 다양한 헤더 명칭 호환 체크
      var schoolType = rowData["학교 유형"] || rowData["학교유형"] || rowData["유형"] || "일반고";
      var link = rowData["교과 편성표(링크)"] || rowData["링크"] || "링크입력예정";
      
      var schoolCode = rowData["학교 코드(고유값)"] || rowData["학교코드(고유값)"] || "";
      if (!schoolCode && name) {
        var prefix = name.substring(0, 4);
        schoolCode = year + prefix;
      }

      var lastCol = Math.max(7, sheet.getLastColumn());
      var headers = sheet.getRange(1, 1, 1, lastCol).getValues()[0];
      var newRow = [];
      
      // 구글 시트 헤더명이 존재하는 경우 해당 열에 맞게 매핑
      if (headers.length >= 7 && headers[0] !== "") {
        for (var i = 0; i < headers.length; i++) {
          var h = String(headers[i]).trim();
          if (h === "입력 시간" || h === "입력시간" || h === "입력일시") newRow.push(timestamp);
          else if (h === "학교 코드(고유값)" || h === "학교코드(고유값)" || h === "학교코드") newRow.push(schoolCode);
          else if (h === "학년도" || h === "연도") newRow.push(year);
          else if (h === "학교명") newRow.push(name);
          else if (h === "학생 수" || h === "학생수" || h === "전교 학생수" || h === "전교학생수") newRow.push(students);
          else if (h === "학교 유형" || h === "학교유형" || h === "유형") newRow.push(schoolType);
          else if (h === "교과 편성표(링크)" || h === "링크") newRow.push(link);
          else newRow.push(rowData[h] || "");
        }
      } else {
        // 기본 7개 컬럼 순서 고정 저장
        newRow = [timestamp, schoolCode, year, name, students, schoolType, link];
      }
      
      sheet.appendRow(newRow);
      response.success = true;
      response.message = "'" + name + "' 학교 기본 정보가 성공적으로 등록되었습니다.";
      response.data = newRow;
      
    // -----------------------------------------------------------------------
    // B. 수시 합격 데이터 등록 ('sushi')
    // -----------------------------------------------------------------------
    } else if (table === "sushi") {
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
      response.message = "수시 합격 데이터(입력일시: " + timestamp + ")가 성공적으로 등록되었습니다.";
      
    // -----------------------------------------------------------------------
    // C. 특별 프로그램 데이터 등록 ('programs')
    // -----------------------------------------------------------------------
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
      response.message = "특별 프로그램 데이터(입력일시: " + timestamp + ")가 성공적으로 등록되었습니다.";
    }
    
  } catch (err) {
    response.success = false;
    response.error = err.toString();
  }
  
  return ContentService.createTextOutput(JSON.stringify(response))
    .setMimeType(ContentService.MimeType.JSON);
}

// 헬퍼 3: 시트 데이터를 JSON 객체 배열로 변환하는 함수
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

// 헬퍼 4: 여러 예비 이름 중 일치하는 시트를 찾아주는 함수
function getSheetByName(ss, nameCandidates) {
  for (var i = 0; i < nameCandidates.length; i++) {
    var sheet = ss.getSheetByName(nameCandidates[i]);
    if (sheet) return sheet;
  }
  return null;
}
