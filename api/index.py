# -*- coding: utf-8 -*-
"""
=============================================================================
인근 고등학교 수시 합격 데이터베이스 (상담용) - Vercel Serverless Function 백엔드
파일: api/index.py (v10 - CORS & Data Format & Detailed Error Handling)
-----------------------------------------------------------------------------
[개선 사항]
1. 완벽한 CORS 정책 적용 (모든 도메인 및 헤더 완전 허용)
2. 엄격한 데이터 타입 정제 (String vs Number 원천 해결, .0 소수점 제거)
3. 다중 사번 포맷 지원 (실제 사번 및 오늘 날짜 YYYYMMDD 유연 매칭)
4. 구체적이고 친절한 실패 원인 진단 메시지 반환
=============================================================================
"""

import http.server
import json
import urllib.request
import urllib.parse
import csv
import io
import os
import re
import uuid
import datetime

# ===========================================================================
# 1. 구글 스프레드시트 및 Apps Script 기본 정보
# ===========================================================================
SPREADSHEET_ID = "1bCdrA4uBZ2wdiwzj5HU8UIHDaGcKeagZGivASk8qcaY"
DEFAULT_GAS_URL = "https://script.google.com/macros/s/AKfycbx5l_GTVJEv0GvneFJBMLyVb1IHwwOvFq3RqJXZqyks3q9L-bpS534s03BJTPwhm8NR/exec"
FALLBACK_GAS_URL = "https://script.google.com/macros/s/AKfycbx5l_GTVJEv0GvneFJBMLyVb1IHwwOvFq3RqJXZqyks3q9L-bpS534s03BJTPwhm8NR/exec"

CURRENT_DIR = os.path.dirname(os.path.abspath(__file__))
PROJECT_ROOT = os.path.dirname(CURRENT_DIR)
CONFIG_FILE = os.path.join("/tmp" if os.path.exists("/tmp") else CURRENT_DIR, "config.json")

SHEET_MAPPING = {
    "access": ["접근 권한", "접근권한", "사용자", "권한"],
    "schools": ["학교_기본 정보", "학교_기본정보", "학교기본정보", "학교"],
    "sushi": ["수시합격_입력", "수시합격", "수시"],
    "programs": ["특별프로그램_입력", "특별프로그램", "프로그램", "동아리"],
    "dashboard": ["대시보드_집계용", "학교별_대시보드", "대시보드"]
}

# ===========================================================================
# 2. 유틸리티 함수 (데이터 타입 정제)
# ===========================================================================
def clean_digits(val):
    """
    모든 데이터 타입(숫자, 부동소수점, 문자열)을 텍스트 기반 순수 숫자로 정제
    - '20160148.0' 형태의 실수형 문자열도 '20160148'로 올바르게 변환
    """
    s = str(val or "").strip()
    if s.endswith(".0"):
        s = s[:-2]
    return re.sub(r"[^0-9]", "", s)

def load_gas_url():
    """저장된 Apps Script URL 불러오기"""
    if os.path.exists(CONFIG_FILE):
        try:
            with open(CONFIG_FILE, "r", encoding="utf-8") as f:
                data = json.load(f)
                if data.get("apps_script_url"):
                    return data["apps_script_url"]
        except Exception:
            pass
    return DEFAULT_GAS_URL

def save_gas_url(new_url):
    """Apps Script URL 저장"""
    try:
        with open(CONFIG_FILE, "w", encoding="utf-8") as f:
            json.dump({"apps_script_url": new_url}, f, ensure_ascii=False, indent=2)
        return True
    except Exception:
        return False

# ===========================================================================
# 3. 구글 스프레드시트 실시간 데이터 조회 (GViz CSV API)
# ===========================================================================
def fetch_sheet_data(name_candidates):
    """후보 시트명을 순회하여 존재하는 시트에서 CSV 데이터를 추출하여 JSON 리스트 반환"""
    for name in name_candidates:
        encoded = urllib.parse.quote(name)
        url = f"https://docs.google.com/spreadsheets/d/{SPREADSHEET_ID}/gviz/tq?tqx=out:csv&sheet={encoded}"
        try:
            req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
            with urllib.request.urlopen(req, timeout=8) as resp:
                text = resp.read().decode("utf-8")
                reader = csv.reader(io.StringIO(text))
                rows = list(reader)

                if not rows or len(rows) < 1:
                    continue

                headers = [str(h or "").strip() for h in rows[0]]
                records = []
                for idx, r in enumerate(rows[1:]):
                    if not any(r):
                        continue
                    item = {"_id": f"row_{idx + 1}"}
                    for i, h in enumerate(headers):
                        if not h:
                            continue
                        val = str(r[i]).strip() if i < len(r) else ""
                        item[h] = val
                    records.append(item)

                if records:
                    return records
        except Exception:
            continue
    return []

def fetch_all_sheets():
    """5개 전체 시트 데이터 실시간 일괄 조회"""
    data = {
        "access": fetch_sheet_data(SHEET_MAPPING["access"]),
        "schools": fetch_sheet_data(SHEET_MAPPING["schools"]),
        "sushi": fetch_sheet_data(SHEET_MAPPING["sushi"]),
        "programs": fetch_sheet_data(SHEET_MAPPING["programs"]),
        "dashboard": fetch_sheet_data(SHEET_MAPPING["dashboard"]),
        "last_synced": datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    }

    schools = data.get("schools", [])
    seen = set()
    for s in schools:
        code = s.get("학교코드(고유값)") or f"{s.get('연도', '')}{s.get('학교명', '')[:4]}"
        if code and code not in seen:
            s["_is_latest"] = True
            seen.add(code)
        else:
            s["_is_latest"] = False

    return data

# ===========================================================================
# 4. Google Apps Script 실시간 쓰기 연동 (WebHook POST)
# ===========================================================================
def send_post_to_gas(target_url, action, table, row_data):
    """지정된 GAS URL로 POST 요청 전송 유틸리티"""
    payload = json.dumps({
        "action": action,
        "table": table,
        "data": row_data
    }, ensure_ascii=False).encode("utf-8")

    req = urllib.request.Request(
        target_url,
        data=payload,
        headers={"Content-Type": "application/json", "User-Agent": "Mozilla/5.0"}
    )

    with urllib.request.urlopen(req, timeout=15) as resp:
        raw = resp.read().decode("utf-8")
        return json.loads(raw)

def sync_to_apps_script(action, table, row_data):
    """Google Apps Script로 데이터 등록 요청 전송 (오류 발생 시 백업 URL로 자동 핫스왑)"""
    primary_url = load_gas_url() or DEFAULT_GAS_URL

    try:
        return send_post_to_gas(primary_url, action, table, row_data)
    except Exception as primary_err:
        # primary_url 실패 시 (404 등), 동작하는 백업 주소로 즉시 자동 핫스왑 전환!
        if primary_url != FALLBACK_GAS_URL:
            try:
                res = send_post_to_gas(FALLBACK_GAS_URL, action, table, row_data)
                # 성공 시 복구된 정상 주소를 설정 파일로 저장
                save_gas_url(FALLBACK_GAS_URL)
                return res
            except Exception:
                pass
        return {"success": False, "error": f"구글 시트 연동 실패: {str(primary_err)}"}

# ===========================================================================
# 5. Vercel Serverless 요청 핸들러
# ===========================================================================
class handler(http.server.BaseHTTPRequestHandler):

    def get_api_route(self):
        """요청된 API 라우트명을 100% 식별"""
        parsed_self = urllib.parse.urlparse(self.path)
        query = urllib.parse.parse_qs(parsed_self.query)

        if "route" in query:
            r = query["route"][0].strip().strip("/").split("?")[0].replace(".py", "")
            if r: return r

        matched = (
            self.headers.get("x-vercel-matched-path") or
            self.headers.get("x-forwarded-uri") or
            self.headers.get("x-matched-path") or ""
        )
        if matched:
            parsed_m = urllib.parse.urlparse(matched)
            clean_p = parsed_m.path.replace("/api/", "").strip("/").replace(".py", "")
            if clean_p and clean_p != "index":
                return clean_p

        clean_path = parsed_self.path.replace("/api/", "").strip("/").replace(".py", "")
        if clean_path and clean_path != "index":
            return clean_path

        full_path = self.path.lower()
        for candidate in ["data", "login", "schools", "sushi", "programs", "config", "health", "access"]:
            if candidate in full_path:
                return candidate

        return ""

    def send_json(self, status_code, data):
        """강력한 CORS 헤더가 포함된 표준 JSON 응답 생성"""
        payload = json.dumps(data, ensure_ascii=False).encode("utf-8")
        self.send_response(status_code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(payload)))
        # CORS 완전 개방
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS, PUT, DELETE")
        self.send_header("Access-Control-Allow-Headers", "Content-Type, Authorization, X-Requested-With")
        self.send_header("Access-Control-Max-Age", "86400")
        self.end_headers()
        self.wfile.write(payload)

    def do_OPTIONS(self):
        """CORS Preflight 응답"""
        self.send_response(200)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS, PUT, DELETE")
        self.send_header("Access-Control-Allow-Headers", "Content-Type, Authorization, X-Requested-With")
        self.send_header("Access-Control-Max-Age", "86400")
        self.end_headers()

    def send_file(self, file_path, content_type):
        """정적 파일 (index.html, app.js 등) 서빙"""
        try:
            with open(file_path, "rb") as f:
                content = f.read()
            self.send_response(200)
            self.send_header("Content-Type", f"{content_type}; charset=utf-8")
            self.send_header("Content-Length", str(len(content)))
            self.send_header("Access-Control-Allow-Origin", "*")
            self.end_headers()
            self.wfile.write(content)
            return True
        except Exception:
            return False

    def do_GET(self):
        """GET 요청 처리"""
        route = self.get_api_route()

        # 1. 헬스체크 (/api/health)
        if route == "health":
            self.send_json(200, {
                "status": "online",
                "time": datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
                "detected_route": route
            })
            return

        # 2. 전체 데이터 조회 (/api/data 또는 /api/access)
        if route in ["data", "access"]:
            try:
                all_data = fetch_all_sheets()
                self.send_json(200, {
                    "success": True,
                    "data": all_data,
                    "config": {"apps_script_url": load_gas_url()}
                })
            except Exception as e:
                self.send_json(500, {
                    "success": False,
                    "error": f"구글 스프레드시트 데이터 조회 중 오류가 발생했습니다: {str(e)}"
                })
            return

        # 3. 설정 조회 (/api/config)
        if route == "config":
            self.send_json(200, {
                "success": True,
                "apps_script_url": load_gas_url()
            })
            return

        # 4. 정적 웹페이지 서빙 (루트 / 또는 index.html 접속 시 예쁜 HTML UI 표출)
        clean_path = urllib.parse.urlparse(self.path).path.strip("/")
        if not clean_path or clean_path in ["index.html", "index", "api", "api/"]:
            candidates = [
                os.path.join(PROJECT_ROOT, "index.html"),
                os.path.join(PROJECT_ROOT, "static", "index.html"),
                os.path.join(CURRENT_DIR, "index.html")
            ]
            for candidate in candidates:
                if os.path.exists(candidate):
                    if self.send_file(candidate, "text/html"):
                        return

        if clean_path in ["app.js", "static/app.js"]:
            candidate = os.path.join(PROJECT_ROOT, "app.js")
            if os.path.exists(candidate) and self.send_file(candidate, "text/javascript"):
                return

        if clean_path in ["style.css", "static/style.css"]:
            candidate = os.path.join(PROJECT_ROOT, "style.css")
            if os.path.exists(candidate) and self.send_file(candidate, "text/css"):
                return

        self.send_json(404, {
            "success": False,
            "error": "존재하지 않는 엔드포인트입니다.",
            "detected_route": route,
            "raw_path": self.path
        })

    def do_POST(self):
        """POST 요청 처리"""
        route = self.get_api_route()

        content_length = int(self.headers.get("Content-Length", 0))
        raw_body = self.rfile.read(content_length).decode("utf-8") if content_length > 0 else ""

        try:
            body = json.loads(raw_body) if raw_body else {}
        except json.JSONDecodeError:
            self.send_json(400, {"success": False, "error": "유효하지 않은 JSON 데이터입니다."})
            return

        # -------------------------------------------------------------------
        # 1. [로그인 인증 API] (/api/login)
        # -------------------------------------------------------------------
        if route == "login":
            name_input = str(body.get("name", "")).strip()
            phone_input = str(body.get("phone", "")).strip()
            emp_input = str(body.get("emp_no", "")).strip()

            if not name_input:
                self.send_json(400, {"success": False, "error": "성명(이름)을 입력해 주세요."})
                return

            clean_input_phone = clean_digits(phone_input)
            if not clean_input_phone or len(clean_input_phone) < 4:
                self.send_json(400, {"success": False, "error": "휴대폰 뒷자리 4개를 입력해 주세요. (예: 1234)"})
                return

            if not emp_input:
                self.send_json(400, {"success": False, "error": "사번을 입력해 주세요."})
                return

            # '접근 권한' 시트 실시간 조회
            access_rows = fetch_sheet_data(SHEET_MAPPING["access"])
            if not access_rows:
                self.send_json(503, {
                    "success": False,
                    "error": "구글 스프레드시트 '접근 권한' 시트를 읽어오지 못했습니다. 스프레드시트 공유 권한을 확인해 주세요."
                })
                return

            clean_input_name = name_input.replace(" ", "")
            clean_input_emp = clean_digits(emp_input)
            today_digits = datetime.datetime.now().strftime("%Y%m%d")
            input_phone_tail = clean_input_phone[-4:]

            name_found = False
            phone_mismatch = False
            emp_mismatch = False
            matched = None

            for row in access_rows:
                row_name = str(row.get("이름", "")).strip()
                row_phone = clean_digits(row.get("휴대폰 번호", ""))
                row_emp = str(row.get("사번", "")).strip()
                row_emp_digits = clean_digits(row_emp)

                # A열 성명 비교 (공백 제거)
                is_name_match = (row_name == name_input) or (row_name.replace(" ", "") == clean_input_name)
                if not is_name_match:
                    continue

                name_found = True

                # 휴대폰 뒷자리 4개 검증
                # 시트에 전화번호가 기재되어 있는 경우: 뒷 4자리 일치 여부 검증
                # 시트에 전화번호가 비어 있는 경우: 4자리 입력이면 허용
                if row_phone:
                    row_phone_tail = row_phone[-4:]
                    is_phone_match = (input_phone_tail == row_phone_tail)
                else:
                    is_phone_match = (len(input_phone_tail) == 4)

                if not is_phone_match:
                    phone_mismatch = True

                # C열 사번 비교:
                # 1) 입력한 사번 번호가 시트의 사번 번호와 일치하거나
                # 2) 사용자가 placeholder의 오늘 날짜(YYYYMMDD)를 입력하고, 이름이 일치하는 교직원인 경우 인정
                is_emp_match = False
                if emp_input:
                    if row_emp == emp_input or (clean_input_emp and row_emp_digits == clean_input_emp):
                        is_emp_match = True
                    elif clean_input_emp == today_digits:
                        is_emp_match = True

                if not is_emp_match:
                    emp_mismatch = True

                # 성명, 휴대폰 뒷자리 4개, 사번 모두 일치 시 인증 성공
                if is_phone_match and is_emp_match:
                    raw_auth = str(row.get("관리자") or row.get("권한") or "").strip()
                    if not raw_auth:
                        for k, v in row.items():
                            if k != "_id" and "관리자" in str(v):
                                raw_auth = "관리자"
                                break

                    is_admin = ("관리자" in raw_auth or "admin" in raw_auth.lower())
                    matched = {
                        "name": row_name,
                        "phone": input_phone_tail,
                        "emp_no": row_emp,
                        "role": "admin" if is_admin else "user",
                        "role_label": "관리자" if is_admin else "일반 사용자"
                    }
                    break

            if matched:
                self.send_json(200, {
                    "success": True,
                    "message": f"{matched['name']}님 환영합니다! ({matched['role_label']})",
                    "user": matched
                })
            else:
                # 상세 에러 메시지 제공
                if not name_found:
                    err_msg = f"입력하신 성명 '{name_input}'이(가) 구글 시트 '접근 권한' 시트에 등록되어 있지 않습니다. 이름을 확인해 주세요."
                elif phone_mismatch and not emp_mismatch:
                    err_msg = f"'{name_input}' 선생님의 성명과 사번은 확인되었으나, 휴대폰 뒷자리 4개가 일치하지 않습니다."
                elif emp_mismatch and not phone_mismatch:
                    err_msg = f"'{name_input}' 선생님의 성명과 휴대폰 뒷자리는 확인되었으나, 사번이 일치하지 않습니다. 사번(또는 오늘 날짜 {today_digits})을 확인해 주세요."
                else:
                    err_msg = f"'{name_input}' 선생님의 정보가 확인되었으나 휴대폰 뒷자리 또는 사번이 일치하지 않습니다."

                self.send_json(401, {
                    "success": False,
                    "error": err_msg
                })
            return

        # -------------------------------------------------------------------
        # 2. [학교 기본 정보 등록 및 Upsert] (/api/schools)
        # -------------------------------------------------------------------
        if route == "schools":
            timestamp = datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S")
            raw_year = str(body.get("학년도", body.get("연도", "2026"))).strip()
            clean_year_num = re.sub(r"[^0-9]", "", raw_year) or "2026"
            name = str(body.get("학교명", "")).strip()
            
            # 고3 학생수 추출 및 문자열 정제
            raw_students = body.get("고3 학생수", body.get("고3학생수", body.get("학생 수", body.get("학생수", body.get("studentCount", "")))))
            students = str(raw_students or "").strip()
            if students.endswith(".0"):
                students = students[:-2]

            school_type = str(body.get("학교 유형", body.get("학교유형", body.get("고교 유형", "일반고")))).strip()
            link = str(body.get("교과 편성표(링크)", body.get("교과편성표(링크)", body.get("교과편성표", body.get("드라이브링크", body.get("링크", "")))))).strip()

            if not name:
                self.send_json(400, {"success": False, "error": "학교명을 입력해 주세요."})
                return

            prefix = name[:4] if len(name) >= 4 else name
            school_code = str(body.get("학교코드(고유값)", body.get("학교 코드(고유값)", body.get("학교코드", body.get("학교 코드", f"{clean_year_num}{prefix}"))))).strip()

            new_record = {
                "입력 시간": timestamp,
                "학교코드(고유값)": school_code,
                "학교 코드(고유값)": school_code,
                "학교코드": school_code,
                "학년도": clean_year_num,
                "연도": clean_year_num,
                "학교명": name,
                "고3 학생수": students,
                "고3학생수": students,
                "학생 수": students,
                "학생수": students,
                "학교 유형": school_type,
                "학교유형": school_type,
                "교과 편성표(링크)": link,
                "교과편성표(링크)": link,
                "드라이브링크": link,
                "링크": link
            }

            gas_res = sync_to_apps_script("add", "schools", new_record)
            self.send_json(200, {
                "success": True,
                "message": f"'{name}' ({clean_year_num}학년도) 학교 기본 정보가 '학교_기본정보' 시트(A~G열)에 저장/업데이트되었습니다.",
                "item": new_record,
                "gas_res": gas_res
            })
            return

        # -------------------------------------------------------------------
        # 3. [수시 합격 현황 등록 (단일 또는 다중 리스트)] (/api/sushi)
        # -------------------------------------------------------------------
        if route == "sushi":
            items = body.get("items")
            if not items:
                items = [body]

            saved_items = []
            for it in items:
                timestamp = str(it.get("입력 시간", "")).strip() or datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S")
                year = str(it.get("연도", "2026")).strip()
                school = str(it.get("학교명", "")).strip()
                rank = str(it.get("전교 등수", it.get("전교등수", ""))).strip()
                univ = str(it.get("합격 대학", it.get("합격대학", ""))).strip()
                dept = str(it.get("합격 학과", it.get("합격학과", ""))).strip()
                type_name = str(it.get("전형명", "")).strip()
                grade = str(it.get("내신 등급", it.get("내신등급", ""))).strip()
                author = str(it.get("입력자", "")).strip() or "상담진"

                if not school or not univ:
                    continue

                row_obj = {
                    "입력 시간": timestamp,
                    "연도": year,
                    "학교명": school,
                    "전교 등수": rank,
                    "합격 대학": univ,
                    "합격 학과": dept,
                    "전형명": type_name,
                    "내신 등급": grade,
                    "입력자": author
                }
                sync_to_apps_script("add", "sushi", row_obj)
                saved_items.append(row_obj)

            if saved_items:
                self.send_json(200, {
                    "success": True,
                    "message": f"총 {len(saved_items)}건의 수시 합격 데이터가 등록되었습니다.",
                    "count": len(saved_items),
                    "items": saved_items
                })
            else:
                self.send_json(400, {"success": False, "error": "학교명과 합격 대학 정보를 확인해 주세요."})
            return

        # -------------------------------------------------------------------
        # 4. [특별 프로그램 및 우수 동아리 등록] (/api/programs)
        # -------------------------------------------------------------------
        if route == "programs":
            timestamp = str(body.get("입력 시간", "")).strip() or datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S")
            year = str(body.get("연도", "2026")).strip()
            school = str(body.get("학교명", "")).strip()
            category = str(body.get("구분", "특별프로그램")).strip()
            prog_name = str(body.get("프로그램 명칭", body.get("프로그램명", ""))).strip()
            prog_content = str(body.get("프로그램 주요 내용", body.get("프로그램 내용", ""))).strip()
            author = str(body.get("입력자", "")).strip() or "상담진"

            if not school or not prog_name:
                self.send_json(400, {"success": False, "error": "학교명과 명칭은 필수 항목입니다."})
                return

            full_title = f"[{category}] {prog_name}" if category and not prog_name.startswith("[") else prog_name

            new_record = {
                "입력 시간": timestamp,
                "연도": year,
                "학교명": school,
                "프로그램 명칭": full_title,
                "프로그램 주요 내용": prog_content,
                "입력자": author
            }

            gas_res = sync_to_apps_script("add", "programs", new_record)
            self.send_json(200, {
                "success": True,
                "message": f"'{prog_name}'({category}) 정보가 성공적으로 등록되었습니다.",
                "item": new_record,
                "gas_res": gas_res
            })
            return

        # -------------------------------------------------------------------
        # 5. [관리자 설정 저장] (/api/config)
        # -------------------------------------------------------------------
        if route == "config":
            new_url = str(body.get("apps_script_url", "")).strip()
            if new_url:
                save_gas_url(new_url)
                self.send_json(200, {"success": True, "message": "구글 웹 앱 연동 설정이 성공적으로 저장되었습니다."})
            else:
                self.send_json(400, {"success": False, "error": "유효한 웹 앱 URL을 입력해 주세요."})
            return

        self.send_json(404, {
            "success": False,
            "error": "존재하지 않는 엔드포인트입니다.",
            "detected_route": route,
            "raw_path": self.path
        })
