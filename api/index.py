# -*- coding: utf-8 -*-
"""
=============================================================================
인근 고등학교 수시 합격 데이터베이스 (상담용) - Vercel Serverless Function 백엔드
파일: api/index.py
-----------------------------------------------------------------------------
[핵심 기능]
1. 구글 스프레드시트 실시간 GViz CSV 데이터 일괄 조회 (/api/data)
2. 상담진 로그인 인증 (/api/login):
   - '접근 권한' 시트 A열(이름), B열(휴대폰 번호), C열(사번) 일치 검증
   - D열 '관리자' 체크 및 최고 관리자 권한 부여
3. 학교 기본 정보 등록 (/api/schools): B열(연도), C열(학교명), D열(학생수), E열(링크)
4. 수시 합격 현황 등록 (/api/sushi):
   - 단일 또는 다중 합격 데이터 일괄 누적 저장 지원 (한 학생의 다중 합격 지원)
5. 특별 프로그램 및 우수 동아리 등록 (/api/programs):
   - 구분(프로그램/동아리), 명칭, 주요 활동 내용, 작성자 누적 저장
6. 관리자 설정 (/api/config):
   - 구글 웹 앱 URL 수정 및 저장
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

CURRENT_DIR = os.path.dirname(os.path.abspath(__file__))
PROJECT_ROOT = os.path.dirname(CURRENT_DIR)
CONFIG_FILE = os.path.join("/tmp" if os.path.exists("/tmp") else CURRENT_DIR, "config.json")

# 시트 이름 매핑 (공백 유무 및 별칭 자동 대응)
SHEET_MAPPING = {
    "access": ["접근 권한", "접근권한", "사용자", "권한"],
    "schools": ["학교_기본정보", "학교기본정보", "학교"],
    "sushi": ["수시합격_입력", "수시합격", "수시"],
    "programs": ["특별프로그램_입력", "특별프로그램", "프로그램", "동아리"],
    "dashboard": ["대시보드_집계용", "학교별_대시보드", "대시보드"]
}

# ===========================================================================
# 2. 유틸리티 함수
# ===========================================================================
def clean_digits(val):
    """숫자만 추출 (하이픈, 공백, 괄호 등 제거)"""
    return re.sub(r"[^0-9]", "", str(val or ""))

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
            with urllib.request.urlopen(req, timeout=10) as resp:
                text = resp.read().decode("utf-8")
                reader = csv.reader(io.StringIO(text))
                rows = list(reader)

                if not rows or len(rows) < 1:
                    continue

                headers = [h.strip() for h in rows[0]]
                records = []
                for idx, r in enumerate(rows[1:]):
                    if not any(r):
                        continue
                    item = {"_id": f"row_{idx + 1}"}
                    for i, h in enumerate(headers):
                        if not h:
                            continue
                        val = r[i].strip() if i < len(r) else ""
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

    # 학교 기본정보의 최신 로그 판별
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
def sync_to_apps_script(action, table, row_data):
    """Google Apps Script로 데이터 등록 요청 전송"""
    gas_url = load_gas_url()
    if not gas_url:
        return {"success": False, "error": "GAS URL 미설정"}

    payload = json.dumps({
        "action": action,
        "table": table,
        "data": row_data
    }, ensure_ascii=False).encode("utf-8")

    req = urllib.request.Request(
        gas_url,
        data=payload,
        headers={"Content-Type": "application/json", "User-Agent": "Mozilla/5.0"}
    )

    try:
        with urllib.request.urlopen(req, timeout=15) as resp:
            raw = resp.read().decode("utf-8")
            return json.loads(raw)
    except Exception as e:
        return {"success": False, "error": str(e)}

# ===========================================================================
# 5. Vercel Serverless 요청 핸들러
# ===========================================================================
class handler(http.server.BaseHTTPRequestHandler):

    def send_json(self, status_code, data):
        """표준 JSON 응답 헤더 및 바디 작성"""
        payload = json.dumps(data, ensure_ascii=False).encode("utf-8")
        self.send_response(status_code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(payload)))
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.end_headers()
        self.wfile.write(payload)

    def do_OPTIONS(self):
        """CORS Preflight 응답"""
        self.send_response(200)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.end_headers()

    def do_GET(self):
        """GET 요청 처리"""
        parsed = urllib.parse.urlparse(self.path)
        path = parsed.path

        # 1. 헬스체크
        if path.endswith("/health"):
            self.send_json(200, {"status": "online", "time": datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S")})
            return

        # 2. 전체 데이터 조회 (/api/data)
        if path.endswith("/data"):
            all_data = fetch_all_sheets()
            self.send_json(200, {
                "success": True,
                "data": all_data,
                "config": {"apps_script_url": load_gas_url()}
            })
            return

        # 3. 설정 조회 (/api/config)
        if path.endswith("/config"):
            self.send_json(200, {
                "success": True,
                "apps_script_url": load_gas_url()
            })
            return

        self.send_json(404, {"success": False, "error": "존재하지 않는 엔드포인트입니다."})

    def do_POST(self):
        """POST 요청 처리"""
        parsed = urllib.parse.urlparse(self.path)
        path = parsed.path

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
        if path.endswith("/login") or "login" in path:
            name_input = str(body.get("name", "")).strip()
            phone_input = str(body.get("phone", "")).strip()
            emp_input = str(body.get("emp_no", "")).strip()

            if not name_input:
                self.send_json(400, {"success": False, "error": "성명(이름)을 입력해 주세요."})
                return

            if not emp_input and not phone_input:
                self.send_json(400, {"success": False, "error": "사번(또는 휴대폰 번호)을 입력해 주세요."})
                return

            # '접근 권한' 시트 실시간 조회
            access_rows = fetch_sheet_data(SHEET_MAPPING["access"])

            clean_input_name = name_input.replace(" ", "")
            clean_input_phone = clean_digits(phone_input)
            clean_input_emp = clean_digits(emp_input)

            matched = None
            for row in access_rows:
                row_name = str(row.get("이름", "")).strip()
                row_phone = clean_digits(row.get("휴대폰 번호", ""))
                row_emp = str(row.get("사번", "")).strip()
                row_emp_digits = clean_digits(row_emp)

                # A열 성명 비교 (공백 제거)
                if not (row_name == name_input or row_name.replace(" ", "") == clean_input_name):
                    continue

                # C열 사번 비교
                emp_match = False
                if emp_input and (row_emp == emp_input or (clean_input_emp and row_emp_digits == clean_input_emp)):
                    emp_match = True

                # B열 휴대폰 번호 비교
                phone_match = False
                if clean_input_phone and row_phone and (clean_input_phone == row_phone):
                    phone_match = True

                # 검증 판정:
                # - 사번이 일치하면 휴대폰 번호가 시트에 누락되어 있어도 통과!
                # - 또는 휴대폰 번호가 일치해도 통과!
                if emp_match or phone_match:
                    raw_auth = str(row.get("관리자") or row.get("권한") or "").strip()
                    if not raw_auth:
                        for k, v in row.items():
                            if k != "_id" and "관리자" in str(v):
                                raw_auth = "관리자"
                                break

                    is_admin = ("관리자" in raw_auth or "admin" in raw_auth.lower())
                    matched = {
                        "name": row_name,
                        "phone": phone_input if phone_input else (row_phone if row_phone else "미등록"),
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
                self.send_json(401, {
                    "success": False,
                    "error": "일치하는 계정을 찾을 수 없습니다. 성명, 휴대폰 번호, 사번을 다시 확인해 주세요."
                })
            return

        # -------------------------------------------------------------------
        # 2. [학교 기본 정보 등록] (/api/schools)
        # -------------------------------------------------------------------
        if path.endswith("/schools") or "schools" in path:
            year = str(body.get("연도", "2026")).strip()
            name = str(body.get("학교명", "")).strip()
            students = str(body.get("전교 학생수", body.get("전교학생수", ""))).strip()
            link = str(body.get("교과 편성표(링크)", body.get("링크", ""))).strip() or "링크입력예정"

            if not name:
                self.send_json(400, {"success": False, "error": "학교명을 입력해 주세요."})
                return

            prefix = name[:4] if len(name) >= 4 else name
            school_code = f"{year}{prefix}"

            new_record = {
                "학교코드(고유값)": school_code,
                "연도": year,
                "학교명": name,
                "전교 학생수": students,
                "교과 편성표(링크)": link,
                "링크": link,
                "데이터 수집 현황": "0 / 10"
            }

            gas_res = sync_to_apps_script("add", "schools", new_record)
            self.send_json(200, {
                "success": True,
                "message": f"'{name}' 학교 정보가 성공적으로 등록되었습니다.",
                "item": new_record,
                "gas_res": gas_res
            })
            return

        # -------------------------------------------------------------------
        # 3. [수시 합격 현황 등록 (단일 또는 다중 리스트 지원)] (/api/sushi)
        # -------------------------------------------------------------------
        if path.endswith("/sushi") or "sushi" in path:
            items = body.get("items")
            # 단일 건 입력인 경우 리스트로 포장
            if not items:
                items = [body]

            saved_items = []
            for it in items:
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
        if path.endswith("/programs") or "programs" in path:
            year = str(body.get("연도", "2026")).strip()
            school = str(body.get("학교명", "")).strip()
            category = str(body.get("구분", "특별프로그램")).strip() # '특별프로그램' 또는 '우수동아리'
            prog_name = str(body.get("프로그램 명칭", body.get("프로그램명", ""))).strip()
            prog_content = str(body.get("프로그램 주요 내용", body.get("프로그램 내용", ""))).strip()
            author = str(body.get("입력자", "")).strip() or "상담진"

            if not school or not prog_name:
                self.send_json(400, {"success": False, "error": "학교명과 명칭은 필수 항목입니다."})
                return

            # 동아리인 경우 명칭 앞에 구분 표시
            full_title = f"[{category}] {prog_name}" if category and not prog_name.startswith("[") else prog_name

            new_record = {
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
        if path.endswith("/config") or "config" in path:
            new_url = str(body.get("apps_script_url", "")).strip()
            if new_url:
                save_gas_url(new_url)
                self.send_json(200, {"success": True, "message": "구글 웹 앱 연동 설정이 성공적으로 저장되었습니다."})
            else:
                self.send_json(400, {"success": False, "error": "유효한 웹 앱 URL을 입력해 주세요."})
            return

        self.send_json(404, {"success": False, "error": "존재하지 않는 엔드포인트입니다."})
