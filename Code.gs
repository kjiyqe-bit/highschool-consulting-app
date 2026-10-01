/**
 * ===========================================================================
 * 인근 고등학교 수시 합격 데이터베이스 (상담용) - Google Apps Script 백엔드 웹앱
 * 파일: Code.gs (v27 - 대시보드 방어적 데이터 반환 및 7개 컬럼 A~G열 Upsert 보장)
 * ===========================================================================
 * [구글 시트 탭별 표준 구조 및 컬럼 배치]
 * 1. '학교_기본정보' (A~G열 7개 컬럼 명세):
 *    - A열 (Index 0): 입력시간 (타임스탬프, YYYY-MM-DD HH:mm:ss)
 *    - B열 (Index 1): 학교코드(고유값) (예: 2026테스트고)
 *    - C열 (Index 2): 학년도 (예: 2026)
 *    - D열 (Index 3): 학교명 (예: 테스트고등학교)
 *    - E열 (Index 4): 고3 학생수 (⚠️ 텍스트 서식으로 저장)
 *    - F열 (Index 5): 학교 유형 (예: 일반고, 자사고, 특목고 등)
 *    - G열 (Index 6): 교과 편성표(링크) (Google Drive URL)
 *
 * 2. '수시합격_입력' (A~I열 9개 컬럼 표준):
 *    - A열: 입력 일시, B열: 학년도, C열: 학교명, D열: 전교 등수, E열: 합격 대학, F열: 합격 학과, G열: 전형명, H열: 내신 등급, I열: 입력자
 *
 * 3. '특별프로그램_입력' (A~F열 6개 컬럼 표준):
 *    - A열: 입력 일시, B열: 학년도, C열: 학교명, D열: 프로그램 명칭, E열: 프로그램 주요 내용, F열: 입력자
 * ===========================================================================
 */

// 1. HTTP GET 요청 처리 (웹앱 전체 시트 데이터 안전 조회)
function doGet(e) {
  var response = { success: true, schools: [], sushi: [], programs: [] };
  
  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    
    // (1) '학교_기본정보' 시트 데이터 안전 읽기
    var schoolSheet = getSheetByName(ss, ["학교_기본정보", "학교_기본 정보", "학교기본정보", "학교"]);
    if (schoolSheet) {
      response.schools = getSheetDataAsObjects(schoolSheet);
    }
    
    // (2) '수시합격_입력' 시트 데이터 안전 읽기
    var sushiSheet = getSheetByName(ss, ["수시합격_입력", "수시합격", "수시"]);
    if (sushiSheet) {
      response.sushi = getSheetDataAsObjects(sushiSheet);
    }
    
    // (3) '특별프로그램_입력' 시트 데이터 안전 읽기
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

// 2. HTTP POST 요청 처리 (신규 데이터 저장 및 Upsert 업데이트)
function doPost(e) {
  var response = { success: false, message: "" };
  
  try {
    var contents = e.postData.contents;
    var data = JSON.parse(contents);
    
    var table = data.table;
    var rowData = data.data || {};
    
    // 학교 기본 정보 저장 요청 처리 ('schools' 테이블)
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
 * 3. '학교_기본정보' 전용 저장/업데이트 함수 (Upsert 지원)
 * 컬럼 명세 (A~G열 7개 순서):
 * A열 (Index 0): 입력시간 (YYYY-MM-DD HH:mm:ss)
 * B열 (Index 1): 학교코드(고유값) (예: 2026테스트고)
 * C열 (Index 2): 학년도 (예: 2026)
 * D열 (Index 3): 학교명 (예: 테스트고등학교)
 * E열 (Index 4): 고3 학생수 (⚠️ 텍스트 서식으로 저장)
 * F열 (Index 5): 학교 유형 (예: 일반고, 자사고 등)
 * G열 (Index 6): 교과 편성표(링크) (Google Drive URL)
 */
function saveSchoolBasicInfo(data) {
  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var sheet = getSheetByName(ss, ["학교_기본정보", "학교_기본 정보", "학교기본정보", "학교"]);
    if (!sheet) {
      throw new Error("'학교_기본정보' 시트를 찾을 수 없습니다.");
    }
    
    // 1. 데이터 항목 정제
    var timestamp = data["입력 시간"] || data["입력시간"] || data["입력일시"] || Utilities.formatDate(new Date(), "Asia/Seoul", "yyyy-MM-dd HH:mm:ss");
    var name = String(data["학교명"] || "").trim();
    var rawYear = data["학년도"] || data["연도"] || "2026";
    var year = String(rawYear).replace(/[^0-9]/g, "");
    
    var prefix = name.length >= 4 ? name.substring(0, 4) : name;
    var schoolCode = String(data["학교코드(고유값)"] || data["학교 코드(고유값)"] || data["학교코드"] || data["학교 코드"] || (year + prefix)).trim();
    
    // 고3 학생수: 명시적 문자열 타입 처리
    var rawStudents = data["고3 학생수"] || data["고3학생수"] || data["학생 수"] || data["학생수"] || data["studentCount"] || "";
    var studentsStr = String(rawStudents).replace(/[^0-9]/g, "");
    if (!studentsStr && rawStudents !== undefined && rawStudents !== null) {
      studentsStr = String(rawStudents).trim();
    }
    var formattedStudents = studentsStr ? "'" + studentsStr : "";
    
    var schoolType = String(data["학교 유형"] || data["학교유형"] || data["고교 유형"] || data["유형"] || "일반고").trim();
    var link = String(data["교과 편성표(링크)"] || data["교과편성표(링크)"] || data["교과편성표"] || data["드라이브링크"] || data["링크"] || "").trim();

    // A~G열 7개 순서 패키지 생성
    var targetRowValues = [
      timestamp,          // A열: 입력시간
      schoolCode,         // B열: 학교코드(고유값)
      year,               // C열: 학년도
      name,               // D열: 학교명
      formattedStudents,  // E열: 고3 학생수 (텍스트 서식)
      schoolType,         // F열: 학교 유형
      link                // G열: 교과 편성표(링크)
    ];

    // 2. 기존 시트에 동일한 [학교코드] 또는 [학년도 + 학교명] 행이 존재하는지 스캔 (Upsert)
    var lastRow = sheet.getLastRow();
    var matchedRowIndex = -1;

    if (lastRow >= 2) {
      var existingData = sheet.getRange(2, 1, lastRow - 1, 7).getValues();
      for (var r = 0; r < existingData.length; r++) {
        var exCode = String(existingData[r][1] || "").trim(); // B열
        var exYear = String(existingData[r][2] || "").replace(/[^0-9]/g, ""); // C열
        var exName = String(existingData[r][3] || "").trim(); // D열

        if ((schoolCode && exCode === schoolCode) || (year && name && exYear === year && exName === name)) {
          matchedRowIndex = r + 2; // 시트 1행 헤더 고려 (+2)
          break;
        }
      }
    }

    // 3. 기존 데이터 있으면 업데이트(Update), 없으면 신규 추가(Insert)
    if (matchedRowIndex > 0) {
      var cellRange = sheet.getRange(matchedRowIndex, 1, 1, 7);
      sheet.getRange(matchedRowIndex, 5).setNumberFormat("@"); // E열 텍스트 서식 강제
      cellRange.setValues([targetRowValues]);
      
      return {
        success: true,
        message: "'" + name + "' (" + year + "학년도) 학교 기본 정보가 구글 시트(A~G열)에서 업데이트되었습니다.",
        action: "update",
        row: matchedRowIndex,
        data: targetRowValues
      };
    } else {
      sheet.appendRow(targetRowValues);
      var newRowIndex = sheet.getLastRow();
      sheet.getRange(newRowIndex, 5).setNumberFormat("@"); // E열 텍스트 서식 강제
      
      return {
        success: true,
        message: "'" + name + "' (" + year + "학년도) 학교 기본 정보가 구글 시트(A~G열)에 신규 저장되었습니다.",
        action: "insert",
        row: newRowIndex,
        data: targetRowValues
      };
    }

  } catch (err) {
    return {
      success: false,
      error: err.toString()
    };
  }
}

// 헬퍼 1: 시트 데이터를 JSON 객체 배열로 안전하게 반환
function getSheetDataAsObjects(sheet) {
  try {
    var lastRow = sheet.getLastRow();
    var lastCol = sheet.getLastColumn();
    if (lastRow <= 1 || lastCol === 0) return [];
    
    var data = sheet.getRange(1, 1, lastRow, lastCol).getValues();
    if (!data || data.length <= 1) return [];
    
    var headers = data[0];
    var result = [];
    
    for (var r = 1; r < data.length; r++) {
      var row = data[r];
      if (!row || row.length === 0) continue;
      
      var obj = {};
      var hasData = false;
      for (var c = 0; c < headers.length; c++) {
        var headerName = String(headers[c] || "").trim();
        if (headerName !== "") {
          var val = row[c];
          obj[headerName] = (val !== null && val !== undefined) ? val : "";
          if (val !== null && val !== undefined && String(val).trim() !== "") {
            hasData = true;
          }
        }
      }
      if (hasData) {
        result.push(obj);
      }
    }
    return result;
  } catch (e) {
    return [];
  }
}

// 헬퍼 2: 여러 후보 이름 중 실제로 존재하는 시트 반환
function getSheetByName(ss, nameCandidates) {
  for (var i = 0; i < nameCandidates.length; i++) {
    var sheet = ss.getSheetByName(nameCandidates[i]);
    if (sheet) return sheet;
  }
  return null;
}
